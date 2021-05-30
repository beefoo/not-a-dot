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
    vAlpha = alpha;
  }
`;

// https://stackoverflow.com/questions/31037195/three-js-custom-shader-and-png-texture-with-transparency
var MaterialFragmentShader = `
  precision mediump float;

  uniform sampler2D map;
  uniform vec3 fogColor;
  uniform float fogDistance;

  varying vec2 vUv;
  varying float vAlpha;

  void main() {
    //fog
    //float depth = gl_FragCoord.z / gl_FragCoord.w;
    //float d = clamp( 0., 1., pow( depth * ( 1./fogDistance ), 2. ) );
    //if( d >= 1. ) discard;

    vec4 diffuseColor = texture2D(map, vUv);
    gl_FragColor = diffuseColor;
    //gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, d );
    // gl_FragColor.a = vAlpha;

    if ( gl_FragColor.a < 0.5 || vAlpha < 0.1) discard;
  }
`;

var App = (function() {

  function App(config) {
    var defaults = {
      minValue: 1,
      maxValue: 1000000,
      number: 500000,
      minCameraDistance: 100,
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
      transitionInDuration: 500,
      cameraMoveDuration: 1000,
      visibleDepth: 512,
      lookDistanceX: 10,
      lookDistanceY: 5,
      lookDistanceZ: 100,
      movePinchDelta: 250,
      moveWheelDelta: 80
    };
    var q = queryParams();
    this.opt = _.extend({}, defaults, config, q);
    this.init();
  }

  function clamp(value, min, max) {
    value = Math.min(value, max);
    value = Math.max(value, min);
    return value;
  }

  function ease(t){
    return (Math.sin((t+1.5)*Math.PI)+1.0) / 2.0;
  }

  function easeOutExp(x, exp) {
    return 1 - Math.pow(1 - x, exp);
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
    // var distance = Math.abs( size / Math.sin( fov / 2 ) );
    var offset = 0.75; // increase this to zoom out, decrease to zoom in
    var distance = Math.abs( size * offset * Math.tan( fov * 2 ) );
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
    var ready = this.loadPeople();
    this.loadListeners();

    $.when(ready).done(function(){
      _this.transitionIn();
      _this.render();
    });
  };

  App.prototype.loadListeners = function(){
    var _this = this;
    this.isTouching = false;

    $(window).on('resize', function(){
      _this.onResize();
    });

    $('.toggle-panel').on('click', function(e){
      _this.toggle($(this));
    });

    this.$sliderInput.on('input', function(e){
      _this.onUserInput($(this).val());
    });

    $(document).on("mousemove", function(e){
      _this.onPointChange(e.pageX, e.pageY);
    });

    this.$scene.on('wheel', function(e){
      _this.onWheelChange(e.originalEvent.deltaY);
    });

    var el = this.$scene[0];

    // var mc = new Hammer.Manager(el, {inputClass: Hammer.TouchInput}); // use this for touch emulation
    var mc = new Hammer.Manager(el);
    mc.add(new Hammer.Pan({ threshold: 0, pointers: 0 }));
    mc.add(new Hammer.Pinch({ threshold: 0 })).recognizeWith(mc.get('pan'));
    // var mc = new Hammer(el);
    // mc.get('pan').set({ direction: Hammer.DIRECTION_ALL });
    mc.on("panstart panmove press", function(e) {
      _this.isTouching = true;
      _this.onPointChange(e.center.x, e.center.y);
    });
    mc.on("panend", function(e) {
      _this.isTouching = false;
    });

    var startScale = -1;
    var startZ = -1;
    mc.on("pinchstart pinchmove", function(e) {
      if(e.type == 'pinchstart' || startScale < 0) {
        startScale = e.scale;
        startZ = _this.camera.position.z;
      }
      _this.onPinch(e.scale - startScale, startZ);
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
      alphaArr[i] = 0;
    }

    // set uv offset to random cell
    var uvOffsetArr = geometry.getAttribute('uvOffset').array;
    var yt = 1.0 / cols;
    var firstPersonIndex = 6; // always make the first person this one
    for (var i=0; i<count; i++) {
      var randomIndex = _.random(0, cellCount-1);
      if (i<=0) randomIndex = firstPersonIndex;
      var i0 = i*2;
      var y = parseInt(randomIndex / cols) / cols;
      var x = (randomIndex % cols) / cols;
      uvOffsetArr[i0] = x;
      uvOffsetArr[i0 + 1] = Math.max(1.0 - y - yt, 0.0);
    }

    // set size, scale, and translate
    var visibleW = this.visibleDimensions.width;
    var visibleH = this.visibleDimensions.height;
    var visibleDepth = Math.min(visibleH, visibleW, this.opt.visibleDepth);
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
    this.geometry = geometry;

    // load texture
    var textureLoader = new THREE.TextureLoader();
    var promise = $.Deferred();
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

      promise.resolve();
    });

    return promise;
  };

  App.prototype.loadScene = function(){
    var $el = this.$scene;
    var w = $el.width();
    var h = $el.height();
    var scene = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera( 75, w / h, 1, 10000 );
    // camera.zoom = 2;
    var renderer = new THREE.WebGLRenderer({
      antialias: true
    });
    renderer.setPixelRatio( window.devicePixelRatio );
    renderer.setClearColor( 0x000000, 0.0 );
    renderer.setSize(w, h);
    $el.append(renderer.domElement);

    this.visibleDimensions = visibleDimensionsAtDepth(this.opt.cameraDistance, camera);
    this.opt.maxCameraDistance = getCameraDistanceToFitDimensions(camera, this.visibleDimensions.width, this.visibleDimensions.height);
    console.log('Visible dimensions: ' + this.visibleDimensions.width + ' x ' + this.visibleDimensions.height);
    camera.position.set(0, 0, this.opt.minCameraDistance);

    var lookAt = camera.position.clone();
    lookAt.sub(new THREE.Vector3(0, 0, this.opt.lookDistanceZ));
    camera.lookAt(lookAt);

    this.viewW = w;
    this.viewH = h;
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;
    this.lookAt = lookAt;
  };

  App.prototype.loadSlider = function(){
    var _this = this;

    this.$sliderInput = $('#slider-input');
    this.$sliderPeople = $('.people');
    this.$sliderDo = $('.do');
    this.previousValue = -1;
    this.currentValue = -1;
    this.$slider = $('#slider');

    this.$slider.slider({
      min: _this.opt.minValue,
      max: _this.opt.maxValue,
      value: _this.opt.minValue,
      create: function(event, ui) {
        _this.onSlide(_this.opt.minValue);
      },
      slide: function(event, ui) {
        if (_this.isTransitioningIn) {
          event.stopPropagation();
          return false;
        }
        _this.onSlide(ui.value, true, false, true);
      },
      change: function(event, ui) {
        if (_this.isTransitioningIn) {
          _this.onSlide(ui.value, true);
        }
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

  App.prototype.moveCamera = function(){
    if (!this.cameraTransitioning) return;

    var now = new Date().getTime();
    var t = norm(now, this.cameraTransitionStart, this.cameraTransitionEnd);
    t = ease(t);

    var cameraZ = lerp(this.cameraZStart, this.cameraZEnd, t);
    this.lookAt.setZ(cameraZ - this.opt.lookDistanceZ);
    this.camera.position.setZ(cameraZ);

    if (t >= 1) {
      this.cameraTransitioning = false;
    }
  };

  App.prototype.moveCameraDelta = function(deltaZ){
    if (this.cameraTransitioning) return;

    var newCameraZ = this.camera.position.z + deltaZ;

    newCameraZ = clamp(newCameraZ, this.opt.minCameraDistance, this.opt.maxCameraDistance);

    this.moveCameraToZ(newCameraZ);


  };

  App.prototype.moveCameraToZ = function(newCameraZ){
    if (this.cameraTransitioning) return;

    this.lookAt.setZ(newCameraZ - this.opt.lookDistanceZ);
    this.camera.position.setZ(newCameraZ);
  };

  // positive delta = pinch in = zoom out
  // negative delta = pinch out = zoom in
  App.prototype.onPinch = function(delta, startCameraZ){
    var cameraDeltaZ = this.opt.movePinchDelta * delta;
    var newCameraZ = startCameraZ - cameraDeltaZ;
    this.moveCameraToZ(newCameraZ);
  };

  App.prototype.onPointChange = function(x, y){
    var nx = x / this.viewW;
    var ny = y / this.viewH;
    this.npointer.x = nx * 2 - 1;
    this.npointer.y = -ny * 2 + 1;
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

    // this.visibleDimensions = visibleDimensionsAtDepth(this.opt.cameraDistance, this.camera);
    // this.opt.maxCameraDistance = getCameraDistanceToFitDimensions(this.camera, this.visibleDimensions.width, this.visibleDimensions.height);
    //
    // // update positions based on new visible dimensions
    // var geometry = this.geometry;
    // var count = this.opt.maxValue;
    // var visibleW = this.visibleDimensions.width;
    // var visibleH = this.visibleDimensions.height;
    // var visibleDepth = Math.min(visibleH, visibleW, this.opt.visibleDepth);
    // var nPositionArr = this.nPositionArr;
    // var translateArr = geometry.getAttribute('translate').array;
    // for (var i=0; i<count; i++) {
    //   var i0 = i*3;
    //   translateArr[i0] = lerp(-visibleW*0.5, visibleW*0.5, nPositionArr[i0]);
    //   translateArr[i0+1] = lerp(-visibleH*0.5, visibleH*0.5, nPositionArr[i0+1]);
    //   translateArr[i0+2] = lerp(-visibleDepth, 0, nPositionArr[i0+2]);
    // }
    // geometry.getAttribute('translate').needsUpdate = true;
    // this.peopleRenderNeeded = true;
  };

  App.prototype.onSlide = function(newValue, playSound, fromInput, shouldUpdateUrl){
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

    if (!fromInput) this.$sliderInput.val(newValue);
    this.currentValue = newValue;
    this.peopleRenderNeeded = true;

    if (playSound) this.throttleSound();
    if (shouldUpdateUrl) this.updateURL();
  };

  App.prototype.onUserInput = function(userValue){
    var value = parseInt(userValue);

    if (isNaN(value)) value = this.opt.number;

    this.$slider.slider('value', value);
    this.onSlide(value, true, true, true);
  };

  // negative delta = zoom in
  // positive delta = zoom out
  App.prototype.onWheelChange = function(deltaY){
    var moveZ = this.opt.moveWheelDelta;
    if (deltaY < 0) moveZ = -moveZ;
    this.moveCameraDelta(moveZ);
  };

  App.prototype.render = function(){
    var _this = this;

    this.renderTransitionIn();
    this.renderPeople();
    this.moveCamera();
    this.rotateCamera();

    this.renderer.render(this.scene, this.camera);

    requestAnimationFrame(function(){
      _this.render();
    });
  };

  App.prototype.renderPeople = function(){
    if (!this.peopleRenderNeeded) return;

    var quantity = this.currentValue;
    var geometry = this.geometry;
    var alphaArr = geometry.getAttribute('alpha').array;
    for (var i=0; i<this.opt.maxValue; i++) {
      if (i < quantity) alphaArr[i] = 1;
      else alphaArr[i] = 0;
    }
    geometry.getAttribute('alpha').needsUpdate = true;
    geometry.getAttribute('translate').needsUpdate = true;

    // move camera to accommodate people
    var visibleDimensions = this.visibleDimensions;
    var extentsArr = this.extentsArr;
    var i = quantity - 1;
    var targetWidth = extentsArr[i*2] * visibleDimensions.width;
    var targetHeight = extentsArr[i*2 + 1] * visibleDimensions.height;
    var targetZ = getCameraDistanceToFitDimensions(this.camera, targetWidth, targetHeight);
    // var nTargetDistance = norm(quantity, this.opt.minValue, this.opt.maxValue);
    // nTargetDistance = easeOutExp(nTargetDistance, 2);
    // var targetZ = lerp(this.opt.minCameraDistance, this.opt.cameraDistance, nTargetDistance);
    targetZ = Math.max(targetZ, this.opt.minCameraDistance);
    this.cameraTransitionStart = new Date().getTime();
    this.cameraTransitionEnd = this.cameraTransitionStart + this.opt.cameraMoveDuration;
    this.cameraZEnd = targetZ;
    this.cameraZStart = this.camera.position.z;
    this.cameraTransitioning = true;

    this.peopleRenderNeeded = false;
  };

  App.prototype.renderTransitionIn = function(){
    if (!this.isTransitioningIn) return;

    var now = new Date().getTime();
    var t = norm(now, this.transitionInStart, this.transitionInEnd);
    t = ease(t);

    var quantity = lerp(this.transitionInStartQuantity, this.transitionInEndQuantity, t);
    quantity = Math.round(quantity);

    this.$slider.slider('value', quantity);

    if (t >= 1) this.isTransitioningIn = false;
  };

  App.prototype.rotateCamera = function(){
    var multiplier = this.isTouching ? -1 : 1; // reverse it if touching

    var x = multiplier * this.npointer.x * this.opt.lookDistanceX;
    var y = multiplier * this.npointer.y * this.opt.lookDistanceY;

    // console.log(x, y);

    this.lookAt.setX(x);
    this.lookAt.setY(y);
    this.camera.lookAt(this.lookAt);
  };

  App.prototype.toggle = function($button){
    var $parent = $button.parent();

    $parent.toggleClass('active');

    var isActive = $parent.hasClass('active');
    if (isActive) $button.text('Hide panel');
    else $button.text('Show panel');
  };

  App.prototype.transitionIn = function(){
    $('.content').addClass('active');
    this.isTransitioningIn = true;
    this.transitionInStart = new Date().getTime();
    this.transitionInEnd = this.transitionInStart + this.opt.transitionInDuration;
    this.transitionInStartQuantity = this.currentValue;
    this.transitionInEndQuantity = this.opt.number;
  };

  App.prototype.updateURL = function(){
    if (window.history.pushState) {
      var params = {number: this.currentValue};
      var queryString = $.param(params);
      var baseUrl = window.location.href.split('?')[0];
      var currentState = window.history.state;
      var newUrl = baseUrl + '?' + queryString;

      // ignore if state is the same
      if (currentState) {
        var currentUrl = baseUrl + '?' + $.param(currentState);
        if (newUrl === currentUrl) return;
      }

      window.historyInitiated = true;
      // console.log('Updating url', newUrl);
      window.history.replaceState(params, '', newUrl);
      // window.history.pushState(data, '', newUrl);
    }
  };

  return App;

})();

$(function() {
  var app = new App({});
});
