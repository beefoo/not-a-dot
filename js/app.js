'use strict';

var App = (function() {

  function App(config) {
    var defaults = {
      minValue: 1,
      maxValue: 1000000,
      number: 500000,
      cameraDistance: 4000,
      audioFile: 'audio/octave/tap-resonant.mp3',
      waitAudioMs: 40 // wait this long before playing sound again
    };
    var q = queryParams();
    this.opt = _.extend({}, defaults, config, q);
    this.init();
  }

  function ease(t){
    return (Math.sin((t+1.5)*Math.PI)+1.0) / 2.0;
  }

  function formatNumber(number) {
    return number.toLocaleString();
  }

  function lerp(a, b, t) {
    return (1.0*b - a) * t + a;
  }

  function norm(value, a, b){
    var denom = (b - a);
    var t = 0;
    if (denom > 0 || denom < 0) {
      t = (1.0 * value - a) / denom;
    }
    if (t < 0) t = 0;
    if (t > 1.0) t = 1.0;
    return t;
  }

  function queryParams(){
    if (location.search.length) {
      var search = location.search.substring(1);
      var parsed = JSON.parse('{"' + search.replace(/&/g, '","').replace(/=/g,'":"') + '"}', function(key, value) { return key===""?value:decodeURIComponent(value) });
      _.each(parsed, function(value, key){
        var dkey = decodeURIComponent(key);
        parsed[dkey] = value;
      });
      return parsed;
    }
    return {};
  }

  App.prototype.init = function(){
    var _this = this;
    this.$el = $('#app');

    this.loadSound();
    this.loadSlider();
    this.loadScene();
  };

  App.prototype.loadSlider = function(){
    var _this = this;

    this.$sliderText = $('#slider-text');
    this.$sliderPeople = $('.people');
    this.$sliderDo = $('.do');
    this.currentValue = -1;

    this.slider = $('#slider').slider({
      min: _this.opt.minValue,
      max: _this.opt.maxValue,
      value: _this.opt.number,
      create: function(event, ui) {
        _this.onSlide(_this.opt.number);
      },
      slide: function(event, ui) {
        _this.onSlide(ui.value, true);
      }
    });
  };

  App.prototype.loadScene = function(){

  };

  App.prototype.loadSound = function(){
    var sound = new Howl({
      src: [this.opt.audioFile]
    });

    this.throttleSound = _.throttle(function(){
      sound.volume(_.random(0.5, 1));
      sound.play()
    }, this.opt.waitAudioMs);
  };

  App.prototype.onSlide = function(newValue, playSound){
    newValue = parseInt(newValue);
    if (newValue < this.opt.minValue) newValue = this.opt.minValue;
    if (newValue > this.opt.maxValue) newValue = this.opt.maxValue;

    if (newValue === this.currentValue) return;

    if (this.currentValue === 1) {
      this.$sliderDo.text('do');
      this.$sliderPeople.text('people');
    }
    else if (newValue === 1) {
      this.$sliderDo.text('does');
      this.$sliderPeople.text('person');
    }

    this.$sliderText.text(formatNumber(newValue));
    this.currentValue = newValue;

    if (playSound) this.throttleSound();
  };

  return App;

})();

$(function() {
  var app = new App({});
});
