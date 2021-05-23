'use strict';

var MaterialVertexShader = `
  precision mediump float;

  uniform float positionTransitionPct;
  uniform float alphaTransitionPct;

  attribute vec2 uvOffset;
  attribute float alpha;
  attribute float alphaDest;
  attribute vec3 scale;
  attribute vec3 translate;
  attribute vec3 translateDest;
  attribute vec3 actualSize;
  attribute vec3 color;

  varying vec2 vUv;
  varying vec3 vColor;
  varying vec3 vUidColor;
  varying float vAlpha;

  #define PI 3.14159
  void main() {
    float pPct = positionTransitionPct;
    if (pPct > 1.0) pPct = 1.0;

    vec3 p = mix( translate, translateDest, pPct );
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    mvPosition.xyz += position * actualSize;
    vUv = uvOffset.xy + uv * actualSize.xy / scale.xy;

    float aPct = alphaTransitionPct;
    if (aPct > 1.0) aPct = 1.0;
    vAlpha = (alphaDest-alpha) * aPct + alpha;

    // move the point far away if alpha zero
    if (vAlpha <= 0.0) {
      p = vec3(-999999., -999999., -999999.);
    }

    vColor = color;

    gl_Position = projectionMatrix * mvPosition;
  }
`;

var MaterialFragmentShader = `
  precision mediump float;

  uniform sampler2D map;
  uniform vec3 fogColor;
  uniform float fogDistance;

  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;

  void main() {
  if( length( vColor ) < .1 )discard;

  //fog
  float depth = gl_FragCoord.z / gl_FragCoord.w;
  float d = clamp( 0., 1., pow( depth * ( 1./fogDistance ), 2. ) );
  if( d >= 1. ) discard;

  vec4 diffuseColor = texture2D(map, vUv);
  gl_FragColor = diffuseColor * vec4(vColor, 1.0);
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, d );
  gl_FragColor.a = vAlpha;
}
`;

var App = (function() {

  function App(config) {
    var defaults = {
      minValue: 1,
      maxValue: 1000000,
      number: 500000,
      cameraDistance: 4000,
      audioFile: 'audio/octave/tap-resonant.mp3',
      waitAudioMs: 40, // wait this long before playing sound again
      textureFile: 'img/crowd_texture.png',
      textureWidth: 2048,
      textureHeight: 2048,
      cellWidth: 256,
      cellHeight: 256,
      cellCount: 42
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
    this.$scene = $('#scene');

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
    var $el = $('#scene');
    var w = $el.width();
    var h = $el.height();
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera( 75, w / h, 0.0001, 8000 );
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setClearColor( 0x000000, 0.0 );
    renderer.setSize(w, h);
    $el.append(renderer.domElement);
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
