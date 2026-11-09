/**
 * @fileoverview Configurable version of vpaid-no-progress.js: a VPAID ad that plays normally from the start but never reports progress.
 *
 * getAdRemainingTime() always returns the full duration, so the playhead IMA reports stays at 0.
 * Our player's 5s check ("no progress yet") then shows the skip button, and a skip is logged with
 * the playhead at 0, which our data counts as "before Q1".
 *
 * Configurable copy of vpaid-no-progress.js (which stays fixed at 15s for the original test tag).
 *
 * The video (from AdParameters) loops for the whole ad; the ad length comes only from durationSeconds,
 * not from the video file. The ad stops itself after durationSeconds.
 *
 * Optional AdParameters (JSON), all in seconds:
 *   durationSeconds       Total ad length. Default 15.
 *   skippableAfterSeconds If set, the ad becomes skippable (VPAID skippableState + AdSkippableStateChange)
 *                         at this point. Default: never skippable.
 *   stallAfterSeconds     If set, the ad freezes at this point: video pauses, no more quartiles, and it
 *                         never stops itself. Simulates a stuck creative. Default: never stalls.
 */

const DEFAULT_DURATION_SECONDS = 15;

const positiveNumberOrNull = function (value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const VpaidNoProgress = function () {
  this.slot_ = null;
  this.videoSlot_ = null;
  this.eventsCallbacks_ = {};
  this.attributes_ = {
    companions: '',
    desiredBitrate: 256,
    expanded: false,
    height: 0,
    icons: '',
    linear: true,
    skippableState: false,
    viewMode: 'normal',
    width: 0,
    volume: 1.0,
  };
  this.quartileEvents_ = [
    { event: 'AdImpression', value: 0 },
    { event: 'AdVideoStart', value: 0 },
    { event: 'AdVideoFirstQuartile', value: 25 },
    { event: 'AdVideoMidpoint', value: 50 },
    { event: 'AdVideoThirdQuartile', value: 75 },
    { event: 'AdVideoComplete', value: 100 },
  ];
  this.nextQuartileIndex_ = 0;
  this.parameters_ = {};
  this.durationSeconds_ = DEFAULT_DURATION_SECONDS;
  this.skippableAfterSeconds_ = null;
  this.stallAfterSeconds_ = null;
  this.startedAt_ = null;
  this.finishTimer_ = null;
  this.skippableTimer_ = null;
  this.stallTimer_ = null;
  this.stalled_ = false;
  this.stopped_ = false;
};

VpaidNoProgress.prototype.handshakeVersion = function () {
  return '2.0';
};

VpaidNoProgress.prototype.initAd = function (width, height, viewMode, desiredBitrate, creativeData, environmentVars) {
  this.attributes_.width = width;
  this.attributes_.height = height;
  this.attributes_.viewMode = viewMode;
  this.attributes_.desiredBitrate = desiredBitrate;
  this.slot_ = environmentVars.slot;
  this.videoSlot_ = environmentVars.videoSlot;
  try {
    this.parameters_ = JSON.parse(creativeData.AdParameters || '{}');
  } catch (e) {
    this.log('could not parse AdParameters: ' + e);
    this.parameters_ = {};
  }
  this.durationSeconds_ = positiveNumberOrNull(this.parameters_.durationSeconds) || DEFAULT_DURATION_SECONDS;
  this.skippableAfterSeconds_ = positiveNumberOrNull(this.parameters_.skippableAfterSeconds);
  this.stallAfterSeconds_ = positiveNumberOrNull(this.parameters_.stallAfterSeconds);

  this.log(
    'initAd ' + width + 'x' + height +
    ' duration=' + this.durationSeconds_ + 's' +
    ' skippableAfter=' + (this.skippableAfterSeconds_ === null ? 'never' : this.skippableAfterSeconds_ + 's') +
    ' stallAfter=' + (this.stallAfterSeconds_ === null ? 'never' : this.stallAfterSeconds_ + 's')
  );
  this.updateVideoSlot_();
  this.videoSlot_.loop = true;
  this.videoSlot_.addEventListener('timeupdate', this.timeUpdateHandler_.bind(this), false);
  if (this.slot_) {
    this.slot_.addEventListener('click', this.clickAd_.bind(this), false);
  }
  this.callEvent_('AdLoaded');
};

VpaidNoProgress.prototype.clickAd_ = function () {
  if (typeof this.eventsCallbacks_.AdClickThru === 'function') {
    this.eventsCallbacks_.AdClickThru('', '0', true);
  }
};

// Quartile events still fire on time, so VAST tracking behaves like a normal ad.
VpaidNoProgress.prototype.timeUpdateHandler_ = function () {
  if (this.startedAt_ === null || this.stalled_ || this.stopped_) {
    return;
  }
  const percentPlayed = ((Date.now() - this.startedAt_) / 10) / this.durationSeconds_;
  // Fire every quartile that is due (more than one can be due on the same tick).
  while (
    this.nextQuartileIndex_ < this.quartileEvents_.length &&
    percentPlayed >= this.quartileEvents_[this.nextQuartileIndex_].value
  ) {
    this.log('quartile ' + this.quartileEvents_[this.nextQuartileIndex_].event);
    this.callEvent_(this.quartileEvents_[this.nextQuartileIndex_].event);
    this.nextQuartileIndex_ += 1;
  }
};

VpaidNoProgress.prototype.updateVideoSlot_ = function () {
  if (this.videoSlot_ == null) {
    this.videoSlot_ = document.createElement('video');
    this.slot_.appendChild(this.videoSlot_);
  }
  this.updateVideoPlayerSize_();
  const videos = this.parameters_.videos || [];
  for (let i = 0; i < videos.length; i++) {
    if (this.videoSlot_.canPlayType(videos[i].mimetype) !== '') {
      this.videoSlot_.setAttribute('src', videos[i].url);
      return;
    }
  }
  this.callEvent_('AdError');
};

VpaidNoProgress.prototype.updateVideoPlayerSize_ = function () {
  this.videoSlot_.setAttribute('width', this.attributes_.width);
  this.videoSlot_.setAttribute('height', this.attributes_.height);
};

VpaidNoProgress.prototype.startAd = function () {
  this.log('startAd: video plays now, but remaining time stays at ' + this.durationSeconds_ + 's');
  this.startedAt_ = Date.now();
  const playResult = this.videoSlot_.play();
  if (playResult && typeof playResult.catch === 'function') {
    playResult.catch((e) => this.log('video.play() rejected: ' + e));
  }
  this.finishTimer_ = setTimeout(this.finishAd_.bind(this), this.durationSeconds_ * 1000);
  if (this.skippableAfterSeconds_ !== null) {
    this.skippableTimer_ = setTimeout(this.becomeSkippable_.bind(this), this.skippableAfterSeconds_ * 1000);
  }
  if (this.stallAfterSeconds_ !== null) {
    this.stallTimer_ = setTimeout(this.stall_.bind(this), this.stallAfterSeconds_ * 1000);
  }
  this.callEvent_('AdStarted');
};

VpaidNoProgress.prototype.becomeSkippable_ = function () {
  if (this.stopped_) {
    return;
  }
  this.log('now skippable');
  this.attributes_.skippableState = true;
  this.callEvent_('AdSkippableStateChange');
};

// Freeze: video pauses, no further quartiles, and the ad never ends on its own.
VpaidNoProgress.prototype.stall_ = function () {
  if (this.stopped_) {
    return;
  }
  this.log('STALLED: video paused, no more events, ad will never end by itself');
  this.stalled_ = true;
  clearTimeout(this.finishTimer_);
  if (this.videoSlot_) {
    this.videoSlot_.pause();
  }
};

VpaidNoProgress.prototype.clearTimers_ = function () {
  clearTimeout(this.finishTimer_);
  clearTimeout(this.skippableTimer_);
  clearTimeout(this.stallTimer_);
};

VpaidNoProgress.prototype.finishAd_ = function () {
  this.timeUpdateHandler_();
  while (this.nextQuartileIndex_ < this.quartileEvents_.length) {
    this.callEvent_(this.quartileEvents_[this.nextQuartileIndex_].event);
    this.nextQuartileIndex_ += 1;
  }
  this.stopAd();
};

VpaidNoProgress.prototype.stopAd = function () {
  if (this.stopped_) {
    return;
  }
  this.stopped_ = true;
  this.log('stopAd');
  this.clearTimers_();
  if (this.videoSlot_) {
    this.videoSlot_.pause();
  }
  // Calling AdStopped immediately terminates the ad. A short timeout lets events go through.
  setTimeout(this.callEvent_.bind(this), 75, 'AdStopped');
};

VpaidNoProgress.prototype.resizeAd = function (width, height, viewMode) {
  this.attributes_.width = width;
  this.attributes_.height = height;
  this.attributes_.viewMode = viewMode;
  this.updateVideoPlayerSize_();
  this.callEvent_('AdSizeChange');
};

VpaidNoProgress.prototype.pauseAd = function () {
  this.videoSlot_.pause();
  this.callEvent_('AdPaused');
};

VpaidNoProgress.prototype.resumeAd = function () {
  if (!this.stalled_) {
    this.videoSlot_.play();
  }
  this.callEvent_('AdPlaying');
};

VpaidNoProgress.prototype.expandAd = function () {
  this.attributes_.expanded = true;
  this.callEvent_('AdExpanded');
};

VpaidNoProgress.prototype.collapseAd = function () {
  this.attributes_.expanded = false;
};

VpaidNoProgress.prototype.skipAd = function () {
  if (!this.attributes_.skippableState || this.stopped_) {
    return;
  }
  this.log('skipAd');
  this.stopped_ = true;
  this.clearTimers_();
  if (this.videoSlot_) {
    this.videoSlot_.pause();
  }
  this.callEvent_('AdSkipped');
};

VpaidNoProgress.prototype.subscribe = function (aCallback, eventName, aContext) {
  this.eventsCallbacks_[eventName] = aCallback.bind(aContext);
};

VpaidNoProgress.prototype.unsubscribe = function (eventName) {
  this.eventsCallbacks_[eventName] = null;
};

VpaidNoProgress.prototype.getAdLinear = function () {
  return this.attributes_.linear;
};

VpaidNoProgress.prototype.getAdWidth = function () {
  return this.attributes_.width;
};

VpaidNoProgress.prototype.getAdHeight = function () {
  return this.attributes_.height;
};

VpaidNoProgress.prototype.getAdExpanded = function () {
  return this.attributes_.expanded;
};

VpaidNoProgress.prototype.getAdSkippableState = function () {
  return this.attributes_.skippableState;
};

// Never counts down: the playhead IMA derives from this stays at 0 for the whole ad.
VpaidNoProgress.prototype.getAdRemainingTime = function () {
  return this.durationSeconds_;
};

VpaidNoProgress.prototype.getAdDuration = function () {
  return this.durationSeconds_;
};

VpaidNoProgress.prototype.getAdVolume = function () {
  return this.attributes_.volume;
};

VpaidNoProgress.prototype.setAdVolume = function (value) {
  this.attributes_.volume = value;
  this.callEvent_('AdVolumeChange');
};

VpaidNoProgress.prototype.getAdCompanions = function () {
  return this.attributes_.companions;
};

VpaidNoProgress.prototype.getAdIcons = function () {
  return this.attributes_.icons;
};

VpaidNoProgress.prototype.log = function (message) {
  console.log('[vpaid-no-progress-configurable] ' + message);
};

VpaidNoProgress.prototype.callEvent_ = function (eventType) {
  const callback = this.eventsCallbacks_[eventType];
  if (typeof callback === 'function') {
    callback();
  }
};

/**
 * Main function called by the IMA VPAID wrapper to get the ad.
 */
var getVPAIDAd = function () {
  return new VpaidNoProgress();
};
