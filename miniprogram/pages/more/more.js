const { getApiBase } = require('../../utils/config.js');

const TYPES = [
  { value: 'BUG', label: 'Bug 问题' },
  { value: 'FEATURE_REQUEST', label: '功能建议' },
  { value: 'CARD_DATA', label: '卡牌数据问题' },
  { value: 'AUDIO', label: '音频问题' },
  { value: 'OTHER', label: '其他' },
];

Page({
  data: {
    items: [
      { id: 'feedback', title: '问题反馈', hint: '提交意见' },
      { id: 'support', title: '打赏支持', hint: '即将开放' },
      { id: 'about', title: '关于', hint: '即将开放' },
    ],
    showForm: false,
    types: TYPES,
    typeIndex: 0,
    message: '',
    charCount: 0,
    submitting: false,
    result: '',
    resultOk: false,
    error: '',
  },
  onTapItem(e) {
    const id = e.currentTarget.dataset.id;
    if (id !== 'feedback') return;
    this.setData({
      showForm: true,
      result: '',
      error: '',
    });
  },
  onTypeChange(e) {
    this.setData({ typeIndex: Number(e.detail.value) || 0 });
  },
  onMessageInput(e) {
    const message = String(e.detail.value || '');
    this.setData({
      message: message,
      charCount: message.length,
      error: '',
      result: '',
    });
  },
  submitFeedback() {
    if (this.data.submitting) return;
    const type = TYPES[this.data.typeIndex] && TYPES[this.data.typeIndex].value;
    const message = String(this.data.message || '').trim();
    const self = this;
    this.setData({ submitting: true, error: '', result: '' });
    wx.request({
      url: getApiBase() + '/api/feedback',
      method: 'POST',
      header: { 'Content-Type': 'application/json' },
      data: { type: type, message: message },
      success(res) {
        const body = res.data || {};
        if (res.statusCode === 200 && body.ok === true) {
          self.setData({
            submitting: false,
            message: '',
            charCount: 0,
            result: '反馈已提交，感谢你的帮助！',
            resultOk: true,
            error: '',
          });
          return;
        }
        self.setData({
          submitting: false,
          result: '',
          resultOk: false,
          error: body.error || '提交失败，请稍后重试',
        });
      },
      fail() {
        self.setData({
          submitting: false,
          result: '',
          resultOk: false,
          error: '无法连接服务器，请稍后重试',
        });
      },
    });
  },
});
