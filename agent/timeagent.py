#!/usr/bin/env python3
"""时间账本 · 电脑记录器

在 Mac / Windows（以及装了 xdotool 的 Linux）上后台运行，每隔几秒看一眼
当前在用哪个软件、哪个窗口，合并成一段段使用记录，每天写一个 JSON 文件：

    usage-<设备名>-<YYYY-MM-DD>.json

把输出目录设在 iCloud Drive / OneDrive / 坚果云等同步盘里，手机或电脑上的
「时间账本」就能导入这些文件做时间分析。离开电脑（无键鼠操作）超过 5 分钟不计时。

只用 Python 标准库，不需要安装任何依赖。

用法：
    python3 timeagent.py run [--out 目录] [--device 名称] [--no-titles]
    python3 timeagent.py report [--days 7]      # 在终端里看最近几天的统计
    python3 timeagent.py install [...同 run 的参数]   # 设为开机自动运行
    python3 timeagent.py uninstall
"""

import argparse
import ctypes
import json
import os
import platform
import re
import socket
import subprocess
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

POLL_SECONDS = 5
IDLE_SECONDS = 300          # 超过 5 分钟没有键鼠操作，算离开
FLUSH_SECONDS = 60          # 每分钟写一次文件
MIN_SESSION_SECONDS = 10    # 太短的切换不记
TITLE_MAX = 120
SYSTEM = platform.system()  # 'Darwin' / 'Windows' / 'Linux'
LABEL = "com.timeledger.agent"


def default_out_dir():
    home = Path.home()
    icloud = home / "Library" / "Mobile Documents" / "com~apple~CloudDocs"
    onedrive = os.environ.get("OneDrive")
    if SYSTEM == "Darwin" and icloud.is_dir():
        return icloud / "TimeLedger"
    if onedrive and Path(onedrive).is_dir():
        return Path(onedrive) / "TimeLedger"
    return home / "TimeLedger"


# ---------------- 读取当前窗口 ----------------

def _run(cmd, timeout=3):
    try:
        return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ""


MAC_SCRIPT = '''
tell application "System Events"
    set p to first application process whose frontmost is true
    set n to name of p
    set t to ""
    try
        set t to name of front window of p
    end try
end tell
return n & "\t" & t
'''

MAC_BROWSER_URL = {
    "Google Chrome": 'tell application "Google Chrome" to get URL of active tab of front window',
    "Microsoft Edge": 'tell application "Microsoft Edge" to get URL of active tab of front window',
    "Brave Browser": 'tell application "Brave Browser" to get URL of active tab of front window',
    "Arc": 'tell application "Arc" to get URL of active tab of front window',
    "Safari": 'tell application "Safari" to get URL of front document',
}


def mac_active():
    out = _run(["osascript", "-e", MAC_SCRIPT])
    if not out:
        return None
    app, _, title = out.partition("\t")
    domain = ""
    if app in MAC_BROWSER_URL:
        # 只保留域名，不记录完整网址
        domain = urlparse(_run(["osascript", "-e", MAC_BROWSER_URL[app]])).hostname or ""
    return app, title, domain


def mac_idle():
    out = _run(["ioreg", "-c", "IOHIDSystem"])
    m = re.search(r'"HIDIdleTime" = (\d+)', out)
    return int(m.group(1)) / 1e9 if m else 0


def win_active():
    user32 = ctypes.windll.user32
    kernel32 = ctypes.windll.kernel32
    hwnd = user32.GetForegroundWindow()
    if not hwnd:
        return None
    length = user32.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(length + 1)
    user32.GetWindowTextW(hwnd, buf, length + 1)
    title = buf.value
    pid = ctypes.c_ulong()
    user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
    app = ""
    handle = kernel32.OpenProcess(0x1000, False, pid.value)  # PROCESS_QUERY_LIMITED_INFORMATION
    if handle:
        size = ctypes.c_ulong(1024)
        path = ctypes.create_unicode_buffer(1024)
        if kernel32.QueryFullProcessImageNameW(handle, 0, path, ctypes.byref(size)):
            app = Path(path.value).stem
        kernel32.CloseHandle(handle)
    app = WIN_APP_NAMES.get(app.lower(), app) or "未知"
    return app, title, ""


WIN_APP_NAMES = {
    "chrome": "Google Chrome", "msedge": "Microsoft Edge", "firefox": "Firefox", "code": "VS Code",
    "winword": "Word", "excel": "Excel", "powerpnt": "PowerPoint", "outlook": "Outlook",
    "wechat": "微信", "weixin": "微信", "dingtalk": "钉钉", "feishu": "飞书", "lark": "飞书",
    "explorer": "文件资源管理器", "wps": "WPS", "et": "WPS 表格", "wpp": "WPS 演示", "qq": "QQ",
    "wemeetapp": "腾讯会议", "zoom": "Zoom", "teams": "Teams", "ms-teams": "Teams", "notion": "Notion",
}


def win_idle():
    class LASTINPUTINFO(ctypes.Structure):
        _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]
    info = LASTINPUTINFO()
    info.cbSize = ctypes.sizeof(info)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(info)):
        return 0
    return ((ctypes.windll.kernel32.GetTickCount() - info.dwTime) & 0xFFFFFFFF) / 1000


def linux_active():
    wid = _run(["xdotool", "getactivewindow"])
    if not wid:
        return None
    title = _run(["xdotool", "getwindowname", wid])
    pid = _run(["xdotool", "getwindowpid", wid])
    app = ""
    if pid:
        try:
            app = Path(f"/proc/{pid}/comm").read_text().strip()
        except OSError:
            pass
    return app or "未知", title, ""


def linux_idle():
    out = _run(["xprintidle"])
    return int(out) / 1000 if out.isdigit() else 0


if SYSTEM == "Darwin":
    get_active, get_idle = mac_active, mac_idle
elif SYSTEM == "Windows":
    get_active, get_idle = win_active, win_idle
else:
    get_active, get_idle = linux_active, linux_idle


# ---------------- 合并成时段，按天写文件 ----------------

class Recorder:
    def __init__(self, out_dir, device, keep_titles=True):
        self.out_dir = Path(out_dir)
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.device = device
        self.keep_titles = keep_titles
        self.current = None      # {"app","title","domain","start","end"}，毫秒
        self.days = {}           # "YYYY-MM-DD" -> [session, ...]
        self.dirty = set()

    def file_for(self, day):
        safe = re.sub(r"[^\w\-]+", "_", self.device)
        return self.out_dir / f"usage-{safe}-{day}.json"

    def load_day(self, day):
        if day not in self.days:
            try:
                data = json.loads(self.file_for(day).read_text(encoding="utf-8"))
                self.days[day] = data.get("sessions", [])
            except (OSError, ValueError):
                self.days[day] = []
        return self.days[day]

    def sample(self, active, idle_seconds, now_ms):
        """每次轮询调用一次。active 为 None 或 (app, title, domain)。"""
        if active is None or idle_seconds >= IDLE_SECONDS:
            # 离开电脑：当前时段在最后一次有操作时结束
            self.close(now_ms - int(idle_seconds * 1000))
            return
        app, title, domain = active
        title = (title or "")[:TITLE_MAX] if self.keep_titles else ""
        key = (app, title, domain)
        cur = self.current
        if cur and (cur["app"], cur["title"], cur["domain"]) == key and now_ms - cur["end"] <= (POLL_SECONDS * 3 + 5) * 1000:
            cur["end"] = now_ms
            return
        self.close(now_ms)
        self.current = {"app": app, "title": title, "domain": domain, "start": now_ms, "end": now_ms}

    def close(self, end_ms):
        cur = self.current
        if not cur:
            return
        cur["end"] = max(cur["start"], end_ms)
        self.current = None
        if cur["end"] - cur["start"] < MIN_SESSION_SECONDS * 1000:
            return
        # 跨零点的时段拆成两天
        start = cur["start"]
        while start < cur["end"]:
            day_start = datetime.fromtimestamp(start / 1000).replace(hour=0, minute=0, second=0, microsecond=0)
            next_day = int((day_start + timedelta(days=1)).timestamp() * 1000)
            piece = dict(cur, start=start, end=min(cur["end"], next_day))
            day = day_start.strftime("%Y-%m-%d")
            sessions = self.load_day(day)
            # 与上一段相同且几乎相连就合并
            if sessions and all(sessions[-1].get(k) == piece[k] for k in ("app", "title", "domain")) and piece["start"] - sessions[-1]["end"] <= 60000:
                sessions[-1]["end"] = piece["end"]
            else:
                sessions.append(piece)
            self.dirty.add(day)
            start = next_day

    def flush(self, include_current=True):
        snapshot = None
        if include_current and self.current and self.current["end"] - self.current["start"] >= MIN_SESSION_SECONDS * 1000:
            # 正在进行的时段也先写进去，避免同步端看到的数据滞后
            snapshot = dict(self.current)
            day = datetime.fromtimestamp(snapshot["start"] / 1000).strftime("%Y-%m-%d")
            self.dirty.add(day)
        for day in sorted(self.dirty):
            sessions = list(self.load_day(day))
            if snapshot and datetime.fromtimestamp(snapshot["start"] / 1000).strftime("%Y-%m-%d") == day:
                sessions.append(snapshot)
            data = {
                "app": "time-ledger-usage", "version": 1, "device": self.device,
                "os": {"Darwin": "mac", "Windows": "windows"}.get(SYSTEM, "linux"),
                "date": day, "updatedAt": int(time.time() * 1000), "sessions": sessions,
            }
            path = self.file_for(day)
            tmp = path.with_suffix(".json.tmp")
            tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, path)
        self.dirty = set()


def run(args):
    rec = Recorder(args.out, args.device, keep_titles=not args.no_titles)
    print(f"时间账本记录器已启动：设备「{args.device}」，写入 {Path(args.out).resolve()}", flush=True)
    if SYSTEM == "Darwin":
        print("第一次运行时，macOS 会请求「辅助功能」或「自动化」权限，允许后才能读取窗口标题。", flush=True)
    last_flush = 0
    try:
        while True:
            now = int(time.time() * 1000)
            try:
                active = get_active()
                idle = get_idle()
            except Exception as e:  # 读取失败（例如锁屏）时当作离开
                print("读取窗口失败：", e, file=sys.stderr, flush=True)
                active, idle = None, 0
            rec.sample(active, idle, now)
            if now - last_flush >= FLUSH_SECONDS * 1000:
                rec.flush()
                last_flush = now
            time.sleep(POLL_SECONDS)
    except KeyboardInterrupt:
        pass
    finally:
        rec.close(int(time.time() * 1000))
        rec.flush(include_current=False)
        print("已停止，记录已保存。")


# ---------------- 终端报告 ----------------

def report(args):
    out = Path(args.out)
    today = datetime.now().date()
    totals, by_day = {}, {}
    for i in range(args.days):
        day = (today - timedelta(days=i)).strftime("%Y-%m-%d")
        for f in out.glob(f"usage-*-{day}.json"):
            try:
                data = json.loads(f.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                continue
            for s in data.get("sessions", []):
                mins = (s["end"] - s["start"]) / 60000
                totals[s["app"]] = totals.get(s["app"], 0) + mins
                by_day[day] = by_day.get(day, 0) + mins
    if not totals:
        print(f"{out} 里最近 {args.days} 天没有记录。")
        return
    fmt = lambda m: f"{int(m // 60)}小时{int(m % 60)}分" if m >= 60 else f"{int(m)}分钟"
    print(f"最近 {args.days} 天电脑使用：共 {fmt(sum(totals.values()))}\n")
    for day in sorted(by_day, reverse=True):
        print(f"  {day}  {fmt(by_day[day])}")
    print("\n按软件：")
    for app, m in sorted(totals.items(), key=lambda kv: -kv[1])[:15]:
        print(f"  {fmt(m):>10}  {app}")


# ---------------- 开机自动运行 ----------------

def run_args(args):
    extra = ["--out", str(Path(args.out).resolve()), "--device", args.device]
    if args.no_titles:
        extra.append("--no-titles")
    return extra


def install(args):
    script = str(Path(__file__).resolve())
    if SYSTEM == "Darwin":
        plist = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
        plist.parent.mkdir(parents=True, exist_ok=True)
        items = "".join(f"<string>{a}</string>" for a in [sys.executable, script, "run", *run_args(args)])
        log = Path.home() / "Library" / "Logs" / "timeledger.log"
        plist.write_text(f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>{LABEL}</string>
  <key>ProgramArguments</key><array>{items}</array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>{log}</string>
  <key>StandardErrorPath</key><string>{log}</string>
</dict></plist>
""", encoding="utf-8")
        _run(["launchctl", "unload", str(plist)])
        _run(["launchctl", "load", str(plist)])
        print(f"已设为登录后自动运行（{plist}）。日志：{log}")
        print("如果统计里没有窗口标题：系统设置 → 隐私与安全性 → 辅助功能 / 自动化，允许 Python。")
    elif SYSTEM == "Windows":
        startup = Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup"
        pyw = Path(sys.executable).with_name("pythonw.exe")
        exe = pyw if pyw.exists() else Path(sys.executable)
        cmd = " ".join(f'"{a}"' for a in [str(exe), script, "run", *run_args(args)])
        vbs = startup / "TimeLedgerAgent.vbs"
        vbs.write_text(f'CreateObject("WScript.Shell").Run "{cmd.replace(chr(34), chr(34) * 2)}", 0, False\n', encoding="utf-8")
        subprocess.Popen(["wscript", str(vbs)])
        print(f"已设为开机自动运行（{vbs}），现在已在后台启动。")
    else:
        unit = Path.home() / ".config" / "systemd" / "user" / "timeledger.service"
        unit.parent.mkdir(parents=True, exist_ok=True)
        unit.write_text(f"""[Unit]
Description=Time Ledger agent
[Service]
ExecStart={sys.executable} {script} run {' '.join(run_args(args))}
Restart=always
[Install]
WantedBy=default.target
""", encoding="utf-8")
        _run(["systemctl", "--user", "enable", "--now", "timeledger.service"])
        print(f"已安装 systemd 用户服务：{unit}")


def uninstall(_args):
    if SYSTEM == "Darwin":
        plist = Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"
        _run(["launchctl", "unload", str(plist)])
        plist.unlink(missing_ok=True)
    elif SYSTEM == "Windows":
        vbs = Path(os.environ["APPDATA"]) / "Microsoft" / "Windows" / "Start Menu" / "Programs" / "Startup" / "TimeLedgerAgent.vbs"
        vbs.unlink(missing_ok=True)
        print("已取消开机运行。当前正在运行的记录器可在任务管理器里结束 pythonw。")
    else:
        _run(["systemctl", "--user", "disable", "--now", "timeledger.service"])
    print("已卸载。")


def main():
    p = argparse.ArgumentParser(description="时间账本 · 电脑记录器")
    sub = p.add_subparsers(dest="cmd")
    for name in ("run", "install", "report", "uninstall"):
        s = sub.add_parser(name)
        s.add_argument("--out", default=str(default_out_dir()), help="输出目录（建议放在同步盘里）")
        s.add_argument("--device", default=socket.gethostname().split(".")[0], help="设备名称")
        s.add_argument("--no-titles", action="store_true", help="不记录窗口标题，只记录软件名")
        s.add_argument("--days", type=int, default=7, help="report 统计的天数")
    args = p.parse_args(sys.argv[1:] or ["run"])
    {"run": run, "install": install, "report": report, "uninstall": uninstall}[args.cmd](args)


if __name__ == "__main__":
    main()
