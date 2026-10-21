/**
 * @fileoverview A VPAID ad that reproduces the "+2s playhead" skip-button bug.
 *
 * It claims to be a 15s ad, but answers getAdRemainingTime() with -2 (the VPAID 2.0 value for
 * "not implemented"). If IMA turns that into currentTime = duration - remainingTime = 17s, our
 * player's "playhead past 16s" rule shows the skip button on the first progress update.
 *
 * The bundled video is only 10s, so it loops and the ad stops itself after AD_DURATION_SECONDS.
 */

const AD_DURATION_SECONDS = 15;
const REPORTED_REMAINING_TIME = -2;

/**
 * @constructor
 */
const VpaidVideoPlayer = function () {
  this.slot_ = null;
  this.videoSlot_ = null;
  this.eventsCallbacks_ = {};
  this.attributes_ = {
    companions: '',
    desiredBitrate: 256,
    duration: AD_DURATION_SECONDS,
    expanded: false,
    height: 0,
    icons: '',
    linear: true,
    remainingTime: REPORTED_REMAINING_TIME,
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
  // Wall-clock start time (ms): the looping video's own currentTime resets, so quartiles use this.
  this.startedAt_ = null;
};

VpaidVideoPlayer.prototype.handshakeVersion = function (version) {
  return '2.0';
};

VpaidVideoPlayer.prototype.initAd = function (width, height, viewMode, desiredBitrate, creativeData, environmentVars) {
  this.attributes_['width'] = width;
  this.attributes_['height'] = height;
  this.attributes_['viewMode'] = viewMode;
  this.attributes_['desiredBitrate'] = desiredBitrate;

  this.slot_ = environmentVars.slot;
  this.videoSlot_ = environmentVars.videoSlot;

  this.parameters_ = JSON.parse(creativeData['AdParameters']);

  this.log('initAd ' + width + 'x' + height + ' ' + viewMode + ' ' + desiredBitrate);
  this.updateVideoSlot_();
  this.videoSlot_.loop = true;
  this.videoSlot_.addEventListener('timeupdate', this.timeUpdateHandler_.bind(this), false);
  this.videoSlot_.addEventListener('loadedmetadata', this.loadedMetadata_.bind(this), false);
  this.slot_.addEventListener('click', this.clickAd_.bind(this), false);
  this.callEvent_('AdLoaded');
};

VpaidVideoPlayer.prototype.clickAd_ = function () {
  if ('AdClickThru' in this.eventsCallbacks_) {
    this.eventsCallbacks_['AdClickThru']('', '0', true);
  }
};

VpaidVideoPlayer.prototype.loadedMetadata_ = function () {
  // Keep claiming AD_DURATION_SECONDS: the real affected creatives are 15s ads.
  this.log('loadedMetadata: video is ' + this.videoSlot_.duration + 's, still reporting ' + AD_DURATION_SECONDS + 's');
};

VpaidVideoPlayer.prototype.timeUpdateHandler_ = function () {
  if (this.startedAt_ === null || this.nextQuartileIndex_ >= this.quartileEvents_.length) {
    return;
  }
  const elapsedSeconds = (Date.now() - this.startedAt_) / 1000;
  const percentPlayed = (elapsedSeconds * 100.0) / AD_DURATION_SECONDS;
  if (percentPlayed >= this.quartileEvents_[this.nextQuartileIndex_].value) {
    this.callEvent_(this.quartileEvents_[this.nextQuartileIndex_].event);
    this.nextQuartileIndex_ += 1;
  }
  // Deliberately never update remainingTime: it stays REPORTED_REMAINING_TIME for the whole ad.
};

VpaidVideoPlayer.prototype.updateVideoSlot_ = function () {
  if (this.videoSlot_ == null) {
    this.videoSlot_ = document.createElement('video');
    this.log('Warning: No video element passed to ad, creating element.');
    this.slot_.appendChild(this.videoSlot_);
  }
  this.updateVideoPlayerSize_();
  let foundSource = false;
  const videos = this.parameters_.videos || [];
  for (let i = 0; i < videos.length; i++) {
    if (this.videoSlot_.canPlayType(videos[i].mimetype) != '') {
      this.videoSlot_.setAttribute('src', videos[i].url);
      foundSource = true;
      break;
    }
  }
  if (!foundSource) {
    this.callEvent_('AdError');
  }
};

VpaidVideoPlayer.prototype.updateVideoPlayerSize_ = function () {
  this.videoSlot_.setAttribute('width', this.attributes_['width']);
  this.videoSlot_.setAttribute('height', this.attributes_['height']);
};

VpaidVideoPlayer.prototype.startAd = function () {
  this.log('Starting custom ad (reports duration ' + AD_DURATION_SECONDS + 's, remaining time ' + REPORTED_REMAINING_TIME + ')');
  this.videoSlot_.play();
  this.startedAt_ = Date.now();
  setTimeout(this.finishAd_.bind(this), AD_DURATION_SECONDS * 1000);
  this.callEvent_('AdStarted');
};

// Fires the remaining quartiles and stops the ad once AD_DURATION_SECONDS have passed.
VpaidVideoPlayer.prototype.finishAd_ = function () {
  while (this.nextQuartileIndex_ < this.quartileEvents_.length) {
    this.callEvent_(this.quartileEvents_[this.nextQuartileIndex_].event);
    this.nextQuartileIndex_ += 1;
  }
  this.videoSlot_.pause();
  this.stopAd();
};

VpaidVideoPlayer.prototype.stopAd = function () {
  this.log('Stopping ad');
  // Calling AdStopped immediately terminates the ad. A short timeout lets events go through.
  setTimeout(this.callEvent_.bind(this), 75, 'AdStopped');
};

VpaidVideoPlayer.prototype.resizeAd = function (width, height, viewMode) {
  this.log('resizeAd ' + width + 'x' + height + ' ' + viewMode);
  this.attributes_['width'] = width;
  this.attributes_['height'] = height;
  this.attributes_['viewMode'] = viewMode;
  this.updateVideoPlayerSize_();
  this.callEvent_('AdSizeChange');
};

VpaidVideoPlayer.prototype.pauseAd = function () {
  this.log('pauseAd');
  this.videoSlot_.pause();
  this.callEvent_('AdPaused');
};

VpaidVideoPlayer.prototype.resumeAd = function () {
  this.log('resumeAd');
  this.videoSlot_.play();
  this.callEvent_('AdPlaying');
};

VpaidVideoPlayer.prototype.expandAd = function () {
  this.log('expandAd');
  this.attributes_['expanded'] = true;
  this.callEvent_('AdExpanded');
};

VpaidVideoPlayer.prototype.collapseAd = function () {
  this.log('collapseAd');
  this.attributes_['expanded'] = false;
};

VpaidVideoPlayer.prototype.skipAd = function () {
  this.log('skipAd');
  if (this.attributes_['skippableState']) {
    this.callEvent_('AdSkipped');
  }
};

VpaidVideoPlayer.prototype.subscribe = function (aCallback, eventName, aContext) {
  this.log('Subscribe ' + eventName);
  this.eventsCallbacks_[eventName] = aCallback.bind(aContext);
};

VpaidVideoPlayer.prototype.unsubscribe = function (eventName) {
  this.log('unsubscribe ' + eventName);
  this.eventsCallbacks_[eventName] = null;
};

VpaidVideoPlayer.prototype.getAdLinear = function () {
  return this.attributes_['linear'];
};

VpaidVideoPlayer.prototype.getAdWidth = function () {
  return this.attributes_['width'];
};

VpaidVideoPlayer.prototype.getAdHeight = function () {
  return this.attributes_['height'];
};

VpaidVideoPlayer.prototype.getAdExpanded = function () {
  this.log('getAdExpanded');
  return this.attributes_['expanded'];
};

VpaidVideoPlayer.prototype.getAdSkippableState = function () {
  this.log('getAdSkippableState');
  return this.attributes_['skippableState'];
};

VpaidVideoPlayer.prototype.getAdRemainingTime = function () {
  this.log('getAdRemainingTime -> ' + this.attributes_['remainingTime']);
  return this.attributes_['remainingTime'];
};

VpaidVideoPlayer.prototype.getAdDuration = function () {
  return this.attributes_['duration'];
};

VpaidVideoPlayer.prototype.getAdVolume = function () {
  this.log('getAdVolume');
  return this.attributes_['volume'];
};

VpaidVideoPlayer.prototype.setAdVolume = function (value) {
  this.attributes_['volume'] = value;
  this.log('setAdVolume ' + value);
  this.callEvent_('AdVolumeChange');
};

VpaidVideoPlayer.prototype.getAdCompanions = function () {
  return this.attributes_['companions'];
};

VpaidVideoPlayer.prototype.getAdIcons = function () {
  return this.attributes_['icons'];
};

VpaidVideoPlayer.prototype.log = function (message) {
  console.log('[vpaid-remaining-minus2] ' + message);
};

VpaidVideoPlayer.prototype.callEvent_ = function (eventType) {
  const callback = this.eventsCallbacks_[eventType];
  if (typeof callback === 'function') {
    callback();
  }
};

/**
 * Main function called by the IMA VPAID wrapper to get the ad.
 */
var getVPAIDAd = function () {
  return new VpaidVideoPlayer();
};
