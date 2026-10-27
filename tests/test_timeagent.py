import json, sys, tempfile, unittest
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "agent"))
import timeagent as ta


def ms(h, m=0, s=0, day=25):
    return int(datetime(2026, 10, day, h, m, s).timestamp() * 1000)


class RecorderTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.r = ta.Recorder(self.dir, "mac mini")

    def read(self, day="2026-10-25"):
        return json.loads(Path(self.dir, f"usage-mac_mini-{day}.json").read_text(encoding="utf-8"))

    def feed(self, start, seconds, active, idle=0):
        for t in range(0, seconds + 1, ta.POLL_SECONDS):
            self.r.sample(active, idle, start + t * 1000)

    def test_merge_and_switch(self):
        self.feed(ms(9), 600, ("VS Code", "main.py", ""))
        self.feed(ms(9, 10, 5), 300, ("微信", "微信", ""))
        self.r.close(ms(9, 15, 10))
        self.r.flush(include_current=False)
        data = self.read()
        self.assertEqual(data["app"], "time-ledger-usage")
        self.assertEqual([s["app"] for s in data["sessions"]], ["VS Code", "微信"])
        self.assertAlmostEqual((data["sessions"][0]["end"] - data["sessions"][0]["start"]) / 60000, 10.1, places=1)

    def test_idle_ends_session_at_last_input(self):
        self.feed(ms(10), 120, ("Word", "报告.docx", ""))
        # 之后 6 分钟没有操作
        self.r.sample(("Word", "报告.docx", ""), 360, ms(10, 8))
        self.r.flush(include_current=False)
        s = self.read()["sessions"][0]
        self.assertEqual(s["end"], ms(10, 2))

    def test_short_switch_dropped(self):
        self.feed(ms(11), 5, ("Finder", "", ""))
        self.r.sample(("Safari", "x", "example.com"), 0, ms(11, 0, 6))
        self.r.close(ms(11, 0, 7))
        self.r.flush(include_current=False)
        self.assertFalse(Path(self.dir, "usage-mac_mini-2026-10-25.json").exists())

    def test_cross_midnight_split(self):
        self.r.current = {"app": "Chrome", "title": "", "domain": "", "start": ms(23, 50), "end": ms(23, 50)}
        self.r.close(ms(0, 20, day=26))
        self.r.flush(include_current=False)
        self.assertEqual(self.read()["sessions"][0]["end"], ms(0, 0, day=26))
        self.assertEqual(self.read("2026-10-26")["sessions"][0]["start"], ms(0, 0, day=26))

    def test_flush_includes_current_and_reloads(self):
        self.feed(ms(14), 120, ("Excel", "预算.xlsx", ""))
        self.r.flush()
        self.assertEqual(len(self.read()["sessions"]), 1)
        # 重启后继续追加，不覆盖已有数据
        r2 = ta.Recorder(self.dir, "mac mini")
        r2.current = {"app": "Zoom", "title": "", "domain": "", "start": ms(15), "end": ms(15, 30)}
        r2.close(ms(15, 30))
        r2.flush(include_current=False)
        self.assertEqual([s["app"] for s in self.read()["sessions"]], ["Excel", "Zoom"])

    def test_no_titles(self):
        r = ta.Recorder(self.dir, "pc", keep_titles=False)
        for t in range(0, 61, 5):
            r.sample(("Chrome", "秘密标题", ""), 0, ms(16) + t * 1000)
        r.close(ms(16, 1, 1))
        r.flush(include_current=False)
        data = json.loads(Path(self.dir, "usage-pc-2026-10-25.json").read_text(encoding="utf-8"))
        self.assertEqual(data["sessions"][0]["title"], "")


if __name__ == "__main__":
    unittest.main()
