'use strict';

var MaterialVertexShader = `
  precision mediump float;

  attribute vec2 uvOffset;
  attribute float alpha;
  attribute vec3 scale;
  attribute vec3 translate;
  attribute vec3 actualSize;
  attribute vec3 color;

  varying vec2 vUv;
  varying vec3 vColor;
  varying vec3 vUidColor;
  varying float vAlpha;

  #define PI 3.14159
  void main() {
    vec3 p = translate;
    vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
    mvPosition.xyz += position * actualSize;
    vUv = uvOffset.xy + uv * actualSize.xy / scale.xy;

    // move the point far away if alpha zero
    if (alpha <= 0.0) {
      p = vec3(-999999., -999999., -999999.);
    }

    gl_Position = projectionMatrix * mvPosition;
  }
`;

// https://stackoverflow.com/questions/31037195/three-js-custom-shader-and-png-texture-with-transparency
var MaterialFragmentShader = `
  precision mediump float;

  uniform sampler2D map;
  uniform vec3 fogColor;
  uniform float fogDistance;

  varying vec2 vUv;

  void main() {
    //fog
    float depth = gl_FragCoord.z / gl_FragCoord.w;
    float d = clamp( 0., 1., pow( depth * ( 1./fogDistance ), 2. ) );
    if( d >= 1. ) discard;

    vec4 diffuseColor = texture2D(map, vUv);
    gl_FragColor = diffuseColor;
    gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, d );
    // gl_FragColor.a = vAlpha;

    if ( gl_FragColor.a < 0.5 ) discard;
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
      cellDepth: 128,
      targetCellW: 64,
      targetCellH: 64,
      cellCount: 42,
      maxRotateDelta: Math.PI / 8,
      rotateSpeed: 0.05
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

  // https://stackoverflow.com/questions/14614252/how-to-fit-camera-to-object
  function getCameraDistanceToFitDimensions(camera, width, height){
    // Convert camera fov degrees to radians
    var fov = camera.fov * ( Math.PI / 180 );

    // Calculate the camera distance
    var size = Math.max(width, height);
    var distance = Math.abs( size / Math.sin( fov / 2 ) );
    return distance;
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

  // https://discourse.threejs.org/t/functions-to-calculate-the-visible-width-height-at-a-given-z-depth-from-a-perspective-camera/269
  function visibleDimensionsAtDepth(depth, camera) {
    // compensate for cameras not positioned at z=0
    var cameraOffset = camera.position.z;
    if ( depth < cameraOffset ) depth -= cameraOffset;
    else depth += cameraOffset;

    // vertical fov in radians
    var vFOV = camera.fov * Math.PI / 180;

    // Math.abs to ensure the result is always positive
    var height = 2 * Math.tan( vFOV / 2 ) * Math.abs( depth );
    var width = height * camera.aspect;

    return {
      width: width,
      height: height
    };
  }

  App.prototype.init = function(){
    var _this = this;
    this.$el = $('#app');
    this.$scene = $('#scene');

    this.npointer = new THREE.Vector2();

    this.loadSound();
    this.loadSlider();
    this.loadPositions(this.opt.maxValue);
    this.loadScene();
    this.loadPeople();
    this.loadListeners();
  };

  App.prototype.loadListeners = function(){
    var _this = this;

    $(window).on('resize', function(){
      _this.onResize();
    });

    $(document).on("mousemove", function(e){
      _this.onPointChange(e.pageX, e.pageY);
    });

    var el = this.$scene[0];
    var mc = new Hammer(el);
    mc.get('pan').set({ direction: Hammer.DIRECTION_ALL });
    mc.on("panstart panmove press", function(e) {
      _this.onPointChange(e.center.x, e.center.y);
    });
  };

  App.prototype.loadPositions = function(count){
    var positions = [];

    for (var i=0; i<count; i++) {
      var nx = Math.random();
      var ny = Math.random();
      var nz = Math.random();
      var a = nx - 0.5;
      var b = ny - 0.5;
      var dist = Math.sqrt( a*a + b*b );
      positions.push([nx, ny, nz, dist]);
    }

    // sort by distance from center
    positions = _.sortBy(positions, function(p){ return p[3]; });

    // calculate extents (width/height of all objects) at each step
    var nPositionArr = new Float32Array(count * 3);
    var extentsArr = new Float32Array(count * 2);
    var maxX = 0, maxY = 0;
    for (var i=0; i<count; i++) {
      var p = positions[i];
      nPositionArr[i*3] = p[0];
      nPositionArr[i*3 + 1] = p[1];
      nPositionArr[i*3 + 2] = p[2];

      maxX = Math.max(maxX, Math.abs(p[0]-0.5)); // max x distance from center
      maxY = Math.max(maxY, Math.abs(p[1]-0.5)); // max y distance from center
      extentsArr[i*2] = maxX * 2;
      extentsArr[i*2 + 1] = maxY * 2;
    };

    this.nPositionArr = nPositionArr;
    this.extentsArr = extentsArr;
  };

  App.prototype.loadPeople = function(){
    var _this = this;
    var scene = this.scene;
    var imageW = this.opt.textureWidth;
    var cellW = this.opt.cellWidth;
    var cellH = this.opt.cellHeight;
    var targetCellW = this.opt.targetCellW;
    var targetCellH = this.opt.targetCellH;
    var count = this.opt.maxValue;
    var cellCount = this.opt.cellCount;
    var cols = parseInt(imageW / cellW);
    var scale = targetCellW / cellW;

    var planeGeom = new THREE.PlaneBufferGeometry(1, 1);
    var geometry = new THREE.InstancedBufferGeometry();
    geometry.copy(planeGeom);
    geometry.instanceCount = count;
    var uvAttr = geometry.getAttribute('uv');
    uvAttr.needsUpdate = true;
    for (var i = 0; i < uvAttr.array.length; i++) {
      uvAttr.array[i] /= imageW;
    }

    // define the shader attributes
    var attributes = [
      {name: 'uvOffset', size: 2},
      {name: 'scale', size: 3},
      {name: 'translate', size: 3},
      {name: 'alpha', size: 1},
      {name: 'actualSize', size: 3}
    ];
    for (var attr of attributes) {
      // allocate the buffer
      var buffer = new Float32Array(geometry.instanceCount * attr.size);
      var buffAttr = new THREE.InstancedBufferAttribute(buffer, attr.size, false, 1);
      buffAttr.setUsage(THREE.DynamicDrawUsage);
      geometry.setAttribute(attr.name, buffAttr);
    }

    // set alpha to zero
    var alphaArr = geometry.getAttribute('alpha').array;
    for (var i=0; i<count; i++) {
      alphaArr[i] = 1;
    }

    // set uv offset to random cell
    var uvOffsetArr = geometry.getAttribute('uvOffset').array;
    var yt = 1.0 / cols;
    for (var i=0; i<count; i++) {
      var randomIndex = _.random(0, cellCount-1);
      var i0 = i*2;
      var y = parseInt(randomIndex / cols) / cols;
      var x = (randomIndex % cols) / cols;
      uvOffsetArr[i0] = x;
      uvOffsetArr[i0 + 1] = Math.max(1.0 - y - yt, 0.0);
    }

    // set size, scale, and translate
    var visibleW = this.visibleDimensions.width;
    var visibleH = this.visibleDimensions.height;
    var visibleDepth = Math.min(visibleH, visibleW);
    // visibleDepth = 256;
    var nPositionArr = this.nPositionArr;
    var sizeArr = geometry.getAttribute('actualSize').array;
    var scaleArr = geometry.getAttribute('scale').array;
    var translateArr = geometry.getAttribute('translate').array;
    for (var i=0; i<count; i++) {
      var i0 = i*3;
      sizeArr[i0] = targetCellW;
      sizeArr[i0+1] = targetCellH;
      sizeArr[i0+2] = 1;
      scaleArr[i0] = scale;
      scaleArr[i0+1] = scale;
      scaleArr[i0+2] = 1;
      translateArr[i0] = lerp(-visibleW*0.5, visibleW*0.5, nPositionArr[i0]);
      translateArr[i0+1] = lerp(-visibleH*0.5, visibleH*0.5, nPositionArr[i0+1]);
      translateArr[i0+2] = lerp(-visibleDepth, 0, nPositionArr[i0+2]);
    }

    for (var attr of attributes) {
      geometry.getAttribute(attr.name).needsUpdate = true
    }

    // load texture
    var textureLoader = new THREE.TextureLoader();
    var texture = textureLoader.load(this.opt.textureFile, function() {
      console.log('Loaded texture');

      // load material
      var material = new THREE.ShaderMaterial({
        uniforms: {
          map: {type: "t", value: texture },
          // fog
          fogColor: {type: "v3", value: new THREE.Vector3()},
          fogDistance: {type: "f", value: 8000}
        },
        vertexShader: MaterialVertexShader,
        fragmentShader: MaterialFragmentShader,
        blending: THREE.NormalBlending,
        // depthTest: false,
        // depthWrite: false,
        transparent: true
      });
      var mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;

      scene.add(mesh);
      console.log('Mesh loaded');

      _this.render();
    });
  };

  App.prototype.loadScene = function(){
    var $el = this.$scene;
    var w = $el.width();
    var h = $el.height();
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera( 75, w / h, 1, 10000 );
    var renderer = new THREE.WebGLRenderer({
      antialias: true
    });
    var anchor = new THREE.Vector3();
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setClearColor( 0x000000, 0.0 );
    renderer.setSize(w, h);
    $el.append(renderer.domElement);

    this.visibleDimensions = visibleDimensionsAtDepth(this.opt.cameraDistance, camera);
    console.log('Visible dimensions: ' + this.visibleDimensions.width + ' x ' + this.visibleDimensions.height);
    camera.position.set(0, 0, this.opt.cameraDistance);
    camera.lookAt(anchor);

    var maxRotateDelta = this.opt.maxRotateDelta;
    var controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enablePan = false;
    controls.minPolarAngle = Math.PI * 0.5 - maxRotateDelta; // radians
  	controls.maxPolarAngle = Math.PI * 0.5 + maxRotateDelta; // radians
  	controls.minAzimuthAngle = -maxRotateDelta; // radians
  	controls.maxAzimuthAngle = maxRotateDelta; // radians
    controls.rotateSpeed = this.opt.rotateSpeed;

    this.viewW = w;
    this.viewH = h;
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.anchor = anchor;
    this.controls = controls;
    this.renderNeeded = true;
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

  App.prototype.loadSound = function(){
    var sound = new Howl({
      src: [this.opt.audioFile]
    });

    this.throttleSound = _.throttle(function(){
      sound.volume(_.random(0.5, 1));
      sound.play()
    }, this.opt.waitAudioMs);
  };

  App.prototype.onResize = function(){
    var $el = this.$scene;
    var w = $el.width();
    var h = $el.height();
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.viewW = w;
    this.viewH = h;

    this.visibleDimensions = visibleDimensionsAtDepth(this.opt.cameraDistance, this.camera);

    this.renderNeeded = true;
  };

  App.prototype.onPointChange = function(pageX, pageY){
    var nx = pageX / this.viewW;
    var ny = pageY / this.viewH;
    this.npointer.x = nx * 2 - 1;
    this.npointer.y = -ny * 2 + 1;
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

  App.prototype.render = function(){
    var _this = this;

    // this.moveCameraWithPointer();
    this.renderer.render(this.scene, this.camera);
    this.controls.update();

    requestAnimationFrame(function(){
      _this.render();
    });
  };

  App.prototype.moveCameraWithPointer = function(){
    var anchor = this.anchor;
    var camera = this.camera;

    var lookDistance = this.opt.lookDistance;
    var lookDelta = lookDistance * this.camera.position.z;
    lookDelta = 0.0001;

    var deltaX = this.npointer.x * lookDelta;
    var deltaY = this.npointer.y * lookDelta;

    camera.position.setX(deltaX);
    camera.position.setY(deltaY);
    camera.lookAt(anchor);
  };

  return App;

})();

$(function() {
  var app = new App({});
});
