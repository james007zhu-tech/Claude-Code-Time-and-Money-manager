// 语音：同时做「语音转文字」（浏览器自带识别）和「保存原始录音」

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

export const speechSupported = () => !!SR;
export const recorderSupported = () => !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);

export class VoiceCapture {
  constructor({ keepAudio = true, onText = () => {}, onError = () => {} } = {}) {
    Object.assign(this, { keepAudio, onText, onError });
    this.active = false;
    this.committed = '';
    this.final = '';
    this.interim = '';
    this.chunks = [];
  }

  async start() {
    this.active = true;
    if (this.keepAudio && recorderSupported()) {
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        this.recorder = new MediaRecorder(this.stream);
        this.recorder.ondataavailable = e => e.data.size && this.chunks.push(e.data);
        this.recorder.start();
      } catch (e) {
        if (!SR) { this.active = false; throw e; }
        this.onError('录音不可用，只做文字识别');
      }
    }
    if (SR) this.startRecognition();
    else if (!this.recorder) {
      this.active = false;
      throw new Error('这个浏览器不支持语音，请用输入法键盘上的话筒');
    }
  }

  startRecognition() {
    const r = new SR();
    r.lang = 'zh-CN';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = e => {
      let fin = '', interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) fin += t; else interim += t;
      }
      this.final = fin;
      this.interim = interim;
      this.onText(this.committed + fin + interim);
    };
    r.onerror = e => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      this.recognitionFailed = true;
      const msg = { 'not-allowed': '没有麦克风或语音识别权限', 'service-not-allowed': '没有语音识别权限', network: '语音识别需要联网', 'audio-capture': '麦克风被占用' }[e.error];
      this.onError(msg || '语音识别出错：' + e.error);
    };
    r.onend = () => {
      // 浏览器停顿一会儿就会自己结束识别，说话没结束就接着识别
      this.committed += this.final + this.interim;
      this.final = this.interim = '';
      if (this.active && !this.recognitionFailed) {
        try { this.startRecognition(); } catch { /* 浏览器拒绝重启就算了 */ }
      } else {
        this.recognitionDone?.();
      }
    };
    this.recognition = r;
    r.start();
  }

  async stop() {
    this.active = false;
    const recognitionEnded = this.recognition
      ? new Promise(resolve => { this.recognitionDone = resolve; setTimeout(resolve, 1500); })
      : null;
    if (this.recognition) {
      try { this.recognition.stop(); } catch { this.recognitionDone(); }
    }
    let audio = null;
    if (this.recorder && this.recorder.state !== 'inactive') {
      audio = await new Promise(resolve => {
        this.recorder.onstop = () => resolve(new Blob(this.chunks, { type: this.recorder.mimeType || 'audio/webm' }));
        this.recorder.stop();
      });
    }
    this.stream?.getTracks().forEach(t => t.stop());
    await recognitionEnded;
    return {
      audio: audio?.size ? audio : null,
      text: (this.committed + this.final + this.interim).trim(),
    };
  }
}
