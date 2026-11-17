"use strict";(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[769],{477:(e,t,r)=>{r.d(t,{X:()=>a});var n=r(2115),i=r(9590);function a({pixelated:e}){let t=(0,i.C)(e=>e.gl),r=(0,i.C)(e=>e.internal.active),o=(0,i.C)(e=>e.performance.current),l=(0,i.C)(e=>e.viewport.initialDpr),s=(0,i.C)(e=>e.setDpr);return n.useEffect(()=>{let n=t.domElement;return()=>{r&&s(l),e&&n&&(n.style.imageRendering="auto")}},[]),n.useEffect(()=>{s(o*l),e&&t.domElement&&(t.domElement.style.imageRendering=1===o?"auto":"pixelated")},[o]),null}},916:(e,t,r)=>{r.d(t,{h:()=>s});var n=r(2115),i=r(4577);let a=e=>{let t,r=new Set,n=(e,n)=>{let i="function"==typeof e?e(t):e;if(!Object.is(i,t)){let e=t;t=(null!=n?n:"object"!=typeof i||null===i)?i:Object.assign({},t,i),r.forEach(r=>r(t,e))}},i=()=>t,a={setState:n,getState:i,getInitialState:()=>o,subscribe:e=>(r.add(e),()=>r.delete(e))},o=t=e(n,i,a);return a},{useSyncExternalStoreWithSelector:o}=i,l=(e,t)=>{let r=e?a(e):a,i=(e,i=t)=>(function(e,t=e=>e,r){let i=o(e.subscribe,e.getState,e.getInitialState,t,r);return n.useDebugValue(i),i})(r,e,i);return Object.assign(i,r),i},s=(e,t)=>e?l(e,t):l},1336:(e,t,r)=>{r.d(t,{o:()=>i});var n=r(5269);class i{constructor(){this.isPass=!0,this.enabled=!0,this.needsSwap=!0,this.clear=!1,this.renderToScreen=!1}setSize(){}render(){console.error("THREE.Pass: .render() must be implemented in derived pass.")}dispose(){}}new n.qUd(-1,1,1,-1,0,1);class a extends n.LoY{constructor(){super(),this.setAttribute("position",new n.qtW([-1,3,0,-1,-1,0,3,-1,0],3)),this.setAttribute("uv",new n.qtW([0,2,0,0,2,0],2))}}new a},3923:(e,t,r)=>{r.d(t,{r:()=>o});var n=r(2115),i=r(9590);let a=(0,n.createContext)(null);function o({iterations:e=10,ms:t=250,threshold:r=.75,step:l=.1,factor:s=.5,flipflops:u=1/0,bounds:f=e=>e>100?[60,100]:[40,60],onIncline:c,onDecline:d,onChange:h,onFallback:m,children:v}){let[p,x]=(0,n.useState)(()=>({fps:0,index:0,factor:s,flipped:0,refreshrate:0,fallback:!1,frames:[],averages:[],subscriptions:new Map,subscribe:e=>{let t=Symbol();return p.subscriptions.set(t,e.current),()=>void p.subscriptions.delete(t)}})),g=0;return(0,i.D)(()=>{let{frames:n,averages:i}=p;if(!p.fallback&&i.length<e){n.push(performance.now());let a=n[n.length-1]-n[0];if(a>=t){if(p.fps=Math.round(n.length/a*1e3)/1,p.refreshrate=Math.max(p.refreshrate,p.fps),i[p.index++%e]=p.fps,i.length===e){let[t,n]=f(p.refreshrate),a=i.filter(e=>e>=n),o=i.filter(e=>e<t);a.length>e*r&&(p.factor=Math.min(1,p.factor+l),p.flipped++,c&&c(p),p.subscriptions.forEach(e=>e.onIncline&&e.onIncline(p))),o.length>e*r&&(p.factor=Math.max(0,p.factor-l),p.flipped++,d&&d(p),p.subscriptions.forEach(e=>e.onDecline&&e.onDecline(p))),g!==p.factor&&(g=p.factor,h&&h(p),p.subscriptions.forEach(e=>e.onChange&&e.onChange(p))),p.flipped>u&&!p.fallback&&(p.fallback=!0,m&&m(p),p.subscriptions.forEach(e=>e.onFallback&&e.onFallback(p))),p.averages=[]}p.frames=[]}}}),n.createElement(a.Provider,{value:p},v)}},4400:(e,t,r)=>{r.d(t,{Af:()=>u,Nz:()=>o,u5:()=>f,y3:()=>h});var n,i,a=r(2115);function o(e,t,r){if(!e)return;if(!0===r(e))return e;let n=t?e.return:e.child;for(;n;){let e=o(n,t,r);if(e)return e;n=t?null:n.sibling}}function l(e){try{return Object.defineProperties(e,{_currentRenderer:{get:()=>null,set(){}},_currentRenderer2:{get:()=>null,set(){}}})}catch(t){return e}}"u">typeof window&&((null==(n=window.document)?void 0:n.createElement)||(null==(i=window.navigator)?void 0:i.product)==="ReactNative")?a.useLayoutEffect:a.useEffect;let s=l(a.createContext(null));class u extends a.Component{render(){return a.createElement(s.Provider,{value:this._reactInternals},this.props.children)}}function f(){let e=a.useContext(s);if(null===e)throw Error("its-fine: useFiber must be called within a <FiberProvider />!");let t=a.useId();return a.useMemo(()=>{for(let r of[e,null==e?void 0:e.alternate]){if(!r)continue;let e=o(r,!1,e=>{let r=e.memoizedState;for(;r;){if(r.memoizedState===t)return!0;r=r.next}});if(e)return e}},[e,t])}let c=Symbol.for("react.context"),d=e=>null!==e&&"object"==typeof e&&"$$typeof"in e&&e.$$typeof===c;function h(){let e=function(){let e=f(),[t]=a.useState(()=>new Map);t.clear();let r=e;for(;r;){let e=r.type;d(e)&&e!==s&&!t.has(e)&&t.set(e,a.use(l(e))),r=r.return}return t}();return a.useMemo(()=>Array.from(e.keys()).reduce((t,r)=>n=>a.createElement(t,null,a.createElement(r.Provider,{...n,value:e.get(r)})),e=>a.createElement(u,{...e})),[e])}},4577:(e,t,r)=>{e.exports=r(9617)},5538:(e,t,r)=>{var n=r(2115),i="function"==typeof Object.is?Object.is:function(e,t){return e===t&&(0!==e||1/e==1/t)||e!=e&&t!=t},a=n.useState,o=n.useEffect,l=n.useLayoutEffect,s=n.useDebugValue;function u(e){var t=e.getSnapshot;e=e.value;try{var r=t();return!i(e,r)}catch(e){return!0}}var f="u"<typeof window||void 0===window.document||void 0===window.document.createElement?function(e,t){return t()}:function(e,t){var r=t(),n=a({inst:{value:r,getSnapshot:t}}),i=n[0].inst,f=n[1];return l(function(){i.value=r,i.getSnapshot=t,u(i)&&f({inst:i})},[e,r,t]),o(function(){return u(i)&&f({inst:i}),e(function(){u(i)&&f({inst:i})})},[e]),s(r),r};t.useSyncExternalStore=void 0!==n.useSyncExternalStore?n.useSyncExternalStore:f},6275:(e,t,r)=>{r.d(t,{Hl:()=>c});var n=r(9590),i=r(2115),a=r(9625);function o(e,t){let r;return(...n)=>{window.clearTimeout(r),r=window.setTimeout(()=>e(...n),t)}}let l=["x","y","top","bottom","left","right","width","height"];var s=r(4400),u=r(5155);function f({ref:e,children:t,fallback:r,resize:s,style:c,gl:d,events:h=n.f,eventSource:m,eventPrefix:v,shadows:p,linear:x,flat:g,legacy:w,orthographic:b,frameloop:y,dpr:_,performance:S,raycaster:M,camera:T,scene:D,onPointerMissed:B,onCreated:E,...U}){i.useMemo(()=>(0,n.e)(a),[]);let C=(0,n.u)(),[R,F]=function({debounce:e,scroll:t,polyfill:r,offsetSize:n}={debounce:0,scroll:!1,offsetSize:!1}){var a,s,u;let f=r||("u"<typeof window?class{}:window.ResizeObserver);if(!f)throw Error("This browser does not support ResizeObserver out of the box. See: https://github.com/react-spring/react-use-measure/#resize-observer-polyfills");let[c,d]=(0,i.useState)({left:0,top:0,width:0,height:0,bottom:0,right:0,x:0,y:0}),h=(0,i.useRef)({element:null,scrollContainers:null,resizeObserver:null,lastBounds:c,orientationHandler:null}),m=e?"number"==typeof e?e:e.scroll:null,v=e?"number"==typeof e?e:e.resize:null,p=(0,i.useRef)(!1);(0,i.useEffect)(()=>(p.current=!0,()=>void(p.current=!1)));let[x,g,w]=(0,i.useMemo)(()=>{let e=()=>{let e,t;if(!h.current.element)return;let{left:r,top:i,width:a,height:o,bottom:s,right:u,x:f,y:c}=h.current.element.getBoundingClientRect(),m={left:r,top:i,width:a,height:o,bottom:s,right:u,x:f,y:c};h.current.element instanceof HTMLElement&&n&&(m.height=h.current.element.offsetHeight,m.width=h.current.element.offsetWidth),Object.freeze(m),p.current&&(e=h.current.lastBounds,t=m,!l.every(r=>e[r]===t[r]))&&d(h.current.lastBounds=m)};return[e,v?o(e,v):e,m?o(e,m):e]},[d,n,m,v]);function b(){h.current.scrollContainers&&(h.current.scrollContainers.forEach(e=>e.removeEventListener("scroll",w,!0)),h.current.scrollContainers=null),h.current.resizeObserver&&(h.current.resizeObserver.disconnect(),h.current.resizeObserver=null),h.current.orientationHandler&&("orientation"in screen&&"removeEventListener"in screen.orientation?screen.orientation.removeEventListener("change",h.current.orientationHandler):"onorientationchange"in window&&window.removeEventListener("orientationchange",h.current.orientationHandler))}function y(){h.current.element&&(h.current.resizeObserver=new f(w),h.current.resizeObserver.observe(h.current.element),t&&h.current.scrollContainers&&h.current.scrollContainers.forEach(e=>e.addEventListener("scroll",w,{capture:!0,passive:!0})),h.current.orientationHandler=()=>{w()},"orientation"in screen&&"addEventListener"in screen.orientation?screen.orientation.addEventListener("change",h.current.orientationHandler):"onorientationchange"in window&&window.addEventListener("orientationchange",h.current.orientationHandler))}return a=w,s=!!t,(0,i.useEffect)(()=>{if(s)return window.addEventListener("scroll",a,{capture:!0,passive:!0}),()=>void window.removeEventListener("scroll",a,!0)},[a,s]),u=g,(0,i.useEffect)(()=>(window.addEventListener("resize",u),()=>void window.removeEventListener("resize",u)),[u]),(0,i.useEffect)(()=>{b(),y()},[t,w,g]),(0,i.useEffect)(()=>b,[]),[e=>{e&&e!==h.current.element&&(b(),h.current.element=e,h.current.scrollContainers=function e(t){let r=[];if(!t||t===document.body)return r;let{overflow:n,overflowX:i,overflowY:a}=window.getComputedStyle(t);return[n,i,a].some(e=>"auto"===e||"scroll"===e)&&r.push(t),[...r,...e(t.parentElement)]}(e),y())},c,x]}({scroll:!0,debounce:{scroll:50,resize:0},...s}),P=i.useRef(null),k=i.useRef(null);i.useImperativeHandle(e,()=>P.current);let j=(0,n.a)(B),[z,I]=i.useState(!1),[O,A]=i.useState(!1);if(z)throw z;if(O)throw O;let L=i.useRef(null);(0,n.b)(()=>{let e=P.current;F.width>0&&F.height>0&&e&&(L.current||(L.current=(0,n.c)(e)),async function(){await L.current.configure({gl:d,scene:D,events:h,shadows:p,linear:x,flat:g,legacy:w,orthographic:b,frameloop:y,dpr:_,performance:S,raycaster:M,camera:T,size:F,onPointerMissed:(...e)=>null==j.current?void 0:j.current(...e),onCreated:e=>{null==e.events.connect||e.events.connect(m?(0,n.i)(m)?m.current:m:k.current),v&&e.setEvents({compute:(e,t)=>{let r=e[v+"X"],n=e[v+"Y"];t.pointer.set(r/t.size.width*2-1,-(2*(n/t.size.height))+1),t.raycaster.setFromCamera(t.pointer,t.camera)}}),null==E||E(e)}}),L.current.render((0,u.jsx)(C,{children:(0,u.jsx)(n.E,{set:A,children:(0,u.jsx)(i.Suspense,{fallback:(0,u.jsx)(n.B,{set:I}),children:null!=t?t:null})})}))}())}),i.useEffect(()=>{let e=P.current;if(e)return()=>(0,n.d)(e)},[]);let H=m?"none":"auto";return(0,u.jsx)("div",{ref:k,style:{position:"relative",width:"100%",height:"100%",overflow:"hidden",pointerEvents:H,...c},...U,children:(0,u.jsx)("div",{ref:R,style:{width:"100%",height:"100%"},children:(0,u.jsx)("canvas",{ref:P,style:{display:"block"},children:r})})})}function c(e){return(0,u.jsx)(s.Af,{children:(0,u.jsx)(f,{...e})})}r(8745)},7385:(e,t,r)=>{let n;r.d(t,{mK:()=>D,s0:()=>_,fL:()=>B,fE:()=>U});var i=r(5155),a=r(2115),o=r(5269),l=r(9590),s=r(6926);function u(e,t,r){return t in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}new o.I9Y,new o.I9Y;function f(e,t){if(!(e instanceof t))throw TypeError("Cannot call a class as a function")}var c=function e(t,r,n){var i=this;f(this,e),u(this,"dot2",function(e,t){return i.x*e+i.y*t}),u(this,"dot3",function(e,t,r){return i.x*e+i.y*t+i.z*r}),this.x=t,this.y=r,this.z=n},d=[new c(1,1,0),new c(-1,1,0),new c(1,-1,0),new c(-1,-1,0),new c(1,0,1),new c(-1,0,1),new c(1,0,-1),new c(-1,0,-1),new c(0,1,1),new c(0,-1,1),new c(0,1,-1),new c(0,-1,-1)],h=[151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180],m=Array(512),v=Array(512),p=0;(p=Math.floor(p))<256&&(p|=p<<8);for(var x,g=0;g<256;g++)x=1&g?h[g]^255&p:h[g]^p>>8&255,m[g]=m[g+256]=x,v[g]=v[g+256]=d[x%12];function w(e){var t=function(e){if("number"==typeof e)e=Math.abs(e);else if("string"==typeof e){var t=e;e=0;for(var r=0;r<t.length;r++)e=(e+(r+1)*(t.charCodeAt(r)%96))%0x7fffffff}return 0===e&&(e=311),e}(e);return function(){var e=48271*t%0x7fffffff;return t=e,e/0x7fffffff}}new function e(t){var r=this;f(this,e),u(this,"seed",0),u(this,"init",function(e){r.seed=e,r.value=w(e)}),u(this,"value",w(this.seed)),this.init(t)}(Math.random());o.LoY;r(521);let b=(0,a.createContext)(null),y=e=>(2&e.getAttributes())==2,_=(0,a.memo)((0,a.forwardRef)(({children:e,camera:t,scene:r,resolutionScale:n,enabled:u=!0,renderPriority:f=1,autoClear:c=!0,depthBuffer:d,enableNormalPass:h,stencilBuffer:m,multisampling:v=8,frameBufferType:p=o.ix0},x)=>{let{gl:g,scene:w,camera:_,size:S}=(0,l.C)(),M=r||w,T=t||_,[D,B,E]=(0,a.useMemo)(()=>{let e=new s.s0(g,{depthBuffer:d,stencilBuffer:m,multisampling:v,frameBufferType:p});e.addPass(new s.AH(M,T));let t=null,r=null;return h&&((r=new s.Xe(M,T)).enabled=!1,e.addPass(r),void 0!==n&&((t=new s.SP({normalBuffer:r.texture,resolutionScale:n})).enabled=!1,e.addPass(t))),[e,r,t]},[T,g,d,m,v,p,M,h,n]);(0,a.useEffect)(()=>D?.setSize(S.width,S.height),[D,S]),(0,l.D)((e,t)=>{if(u){let e=g.autoClear;g.autoClear=c,m&&!c&&g.clearStencil(),D.render(t),g.autoClear=e}},u?f:0);let U=(0,a.useRef)(null);(0,a.useLayoutEffect)(()=>{let e=[],t=U.current.__r3f;if(t&&D){let r=t.children;for(let t=0;t<r.length;t++){let n=r[t].object;if(n instanceof s.Mj){let i=[n];if(!y(n)){let e=null;for(;(e=r[t+1]?.object)instanceof s.Mj&&!y(e);)i.push(e),t++}let a=new s.Vu(T,...i);e.push(a)}else n instanceof s.oF&&e.push(n)}for(let t of e)D?.addPass(t);B&&(B.enabled=!0),E&&(E.enabled=!0)}return()=>{for(let t of e)D?.removePass(t);B&&(B.enabled=!1),E&&(E.enabled=!1)}},[D,e,T,B,E]),(0,a.useEffect)(()=>{let e=g.toneMapping;return g.toneMapping=o.y_p,()=>{g.toneMapping=e}},[g]);let C=(0,a.useMemo)(()=>({composer:D,normalPass:B,downSamplingPass:E,resolutionScale:n,camera:T,scene:M}),[D,B,E,n,T,M]);return(0,a.useImperativeHandle)(x,()=>D,[D]),(0,i.jsx)(b.Provider,{value:C,children:(0,i.jsx)("group",{ref:U,children:e})})})),S=0,M=new WeakMap,T=(e,t)=>function({blendFunction:r=t?.blendFunction,opacity:n=t?.opacity,...o}){let s=M.get(e);if(!s){let t=`@react-three/postprocessing/${e.name}-${S++}`;(0,l.e)({[t]:e}),M.set(e,s=t)}let u=(0,l.C)(e=>e.camera),f=a.useMemo(()=>[...t?.args??[],...o.args??[{...t,...o}]],[JSON.stringify(o)]);return(0,i.jsx)(s,{camera:u,"blendMode-blendFunction":r,"blendMode-opacity-value":n,...o,args:f})};s.Mj;let D=T(s.bv,{blendFunction:0}),B=T(s.i,{blendFunction:5});s.hH;var E=((n=E||{})[n.Linear=0]="Linear",n[n.Radial=1]="Radial",n[n.MirroredLinear=2]="MirroredLinear",n);s.Mj;let U=T(s.K1),C=(s.To,{fragmentShader:`

    // original shader by Evan Wallace

    #define MAX_ITERATIONS 100

    uniform float blur;
    uniform float taper;
    uniform vec2 start;
    uniform vec2 end;
    uniform vec2 direction;
    uniform int samples;

    float random(vec3 scale, float seed) {
        /* use the fragment position for a different seed per-pixel */
        return fract(sin(dot(gl_FragCoord.xyz + seed, scale)) * 43758.5453 + seed);
    }

    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec4 color = vec4(0.0);
        float total = 0.0;
        vec2 startPixel = vec2(start.x * resolution.x, start.y * resolution.y);
        vec2 endPixel = vec2(end.x * resolution.x, end.y * resolution.y);
        float f_samples = float(samples);
        float half_samples = f_samples / 2.0;

        // use screen diagonal to normalize blur radii
        float maxScreenDistance = distance(vec2(0.0), resolution); // diagonal distance
        float gradientRadius = taper * (maxScreenDistance);
        float blurRadius = blur * (maxScreenDistance / 16.0);

        /* randomize the lookup values to hide the fixed number of samples */
        float offset = random(vec3(12.9898, 78.233, 151.7182), 0.0);
        vec2 normal = normalize(vec2(startPixel.y - endPixel.y, endPixel.x - startPixel.x));
        float radius = smoothstep(0.0, 1.0, abs(dot(uv * resolution - startPixel, normal)) / gradientRadius) * blurRadius;

        #pragma unroll_loop_start
        for (int i = 0; i <= MAX_ITERATIONS; i++) {
            if (i >= samples) { break; } // return early if over sample count
            float f_i = float(i);
            float s_i = -half_samples + f_i;
            float percent = (s_i + offset - 0.5) / half_samples;
            float weight = 1.0 - abs(percent);
            vec4 sample_i = texture2D(inputBuffer, uv + normalize(direction) / resolution * percent * radius);
            /* switch to pre-multiplied alpha to correctly blur transparent images */
            sample_i.rgb *= sample_i.a;
            color += sample_i * weight;
            total += weight;
        }
        #pragma unroll_loop_end

        outputColor = color / total;

        /* switch back from pre-multiplied alpha */
        outputColor.rgb /= outputColor.a + 0.00001;
    }
    `});s.Mj;s.Mj;s.Mj},7930:(e,t)=>{function r(e,t){var r=e.length;for(e.push(t);0<r;){var n=r-1>>>1,i=e[n];if(0<a(i,t))e[n]=t,e[r]=i,r=n;else break}}function n(e){return 0===e.length?null:e[0]}function i(e){if(0===e.length)return null;var t=e[0],r=e.pop();if(r!==t){e[0]=r;for(var n=0,i=e.length,o=i>>>1;n<o;){var l=2*(n+1)-1,s=e[l],u=l+1,f=e[u];if(0>a(s,r))u<i&&0>a(f,s)?(e[n]=f,e[u]=r,n=u):(e[n]=s,e[l]=r,n=l);else if(u<i&&0>a(f,r))e[n]=f,e[u]=r,n=u;else break}}return t}function a(e,t){var r=e.sortIndex-t.sortIndex;return 0!==r?r:e.id-t.id}if(t.unstable_now=void 0,"object"==typeof performance&&"function"==typeof performance.now){var o,l=performance;t.unstable_now=function(){return l.now()}}else{var s=Date,u=s.now();t.unstable_now=function(){return s.now()-u}}var f=[],c=[],d=1,h=null,m=3,v=!1,p=!1,x=!1,g=!1,w="function"==typeof setTimeout?setTimeout:null,b="function"==typeof clearTimeout?clearTimeout:null,y="u">typeof setImmediate?setImmediate:null;function _(e){for(var t=n(c);null!==t;){if(null===t.callback)i(c);else if(t.startTime<=e)i(c),t.sortIndex=t.expirationTime,r(f,t);else break;t=n(c)}}function S(e){if(x=!1,_(e),!p)if(null!==n(f))p=!0,M||(M=!0,o());else{var t=n(c);null!==t&&F(S,t.startTime-e)}}var M=!1,T=-1,D=5,B=-1;function E(){return!!g||!(t.unstable_now()-B<D)}function U(){if(g=!1,M){var e=t.unstable_now();B=e;var r=!0;try{e:{p=!1,x&&(x=!1,b(T),T=-1),v=!0;var a=m;try{t:{for(_(e),h=n(f);null!==h&&!(h.expirationTime>e&&E());){var l=h.callback;if("function"==typeof l){h.callback=null,m=h.priorityLevel;var s=l(h.expirationTime<=e);if(e=t.unstable_now(),"function"==typeof s){h.callback=s,_(e),r=!0;break t}h===n(f)&&i(f),_(e)}else i(f);h=n(f)}if(null!==h)r=!0;else{var u=n(c);null!==u&&F(S,u.startTime-e),r=!1}}break e}finally{h=null,m=a,v=!1}}}finally{r?o():M=!1}}}if("function"==typeof y)o=function(){y(U)};else if("u">typeof MessageChannel){var C=new MessageChannel,R=C.port2;C.port1.onmessage=U,o=function(){R.postMessage(null)}}else o=function(){w(U,0)};function F(e,r){T=w(function(){e(t.unstable_now())},r)}t.unstable_IdlePriority=5,t.unstable_ImmediatePriority=1,t.unstable_LowPriority=4,t.unstable_NormalPriority=3,t.unstable_Profiling=null,t.unstable_UserBlockingPriority=2,t.unstable_cancelCallback=function(e){e.callback=null},t.unstable_forceFrameRate=function(e){0>e||125<e?console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported"):D=0<e?Math.floor(1e3/e):5},t.unstable_getCurrentPriorityLevel=function(){return m},t.unstable_next=function(e){switch(m){case 1:case 2:case 3:var t=3;break;default:t=m}var r=m;m=t;try{return e()}finally{m=r}},t.unstable_requestPaint=function(){g=!0},t.unstable_runWithPriority=function(e,t){switch(e){case 1:case 2:case 3:case 4:case 5:break;default:e=3}var r=m;m=e;try{return t()}finally{m=r}},t.unstable_scheduleCallback=function(e,i,a){var l=t.unstable_now();switch(a="object"==typeof a&&null!==a&&"number"==typeof(a=a.delay)&&0<a?l+a:l,e){case 1:var s=-1;break;case 2:s=250;break;case 5:s=0x3fffffff;break;case 4:s=1e4;break;default:s=5e3}return s=a+s,e={id:d++,callback:i,priorityLevel:e,startTime:a,expirationTime:s,sortIndex:-1},a>l?(e.sortIndex=a,r(c,e),null===n(f)&&e===n(c)&&(x?(b(T),T=-1):x=!0,F(S,a-l))):(e.sortIndex=s,r(f,e),p||v||(p=!0,M||(M=!0,o()))),e},t.unstable_shouldYield=E,t.unstable_wrapCallback=function(e){var t=m;return function(){var r=m;m=t;try{return e.apply(this,arguments)}finally{m=r}}}},7951:(e,t,r)=>{function n(){return(n=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t];for(var n in r)({}).hasOwnProperty.call(r,n)&&(e[n]=r[n])}return e}).apply(null,arguments)}r.d(t,{d:()=>c});var i=r(2115),a=r(5269),o=r(9590);let l=parseInt(a.sPf.replace(/\D+/g,""));class s extends a.BKk{constructor(e=new a.I9Y){super({uniforms:{inputBuffer:new a.nc$(null),depthBuffer:new a.nc$(null),resolution:new a.nc$(new a.I9Y),texelSize:new a.nc$(new a.I9Y),halfTexelSize:new a.nc$(new a.I9Y),kernel:new a.nc$(0),scale:new a.nc$(1),cameraNear:new a.nc$(0),cameraFar:new a.nc$(1),minDepthThreshold:new a.nc$(0),maxDepthThreshold:new a.nc$(1),depthScale:new a.nc$(0),depthToBlurRatioBias:new a.nc$(.25)},fragmentShader:`#include <common>
        #include <dithering_pars_fragment>      
        uniform sampler2D inputBuffer;
        uniform sampler2D depthBuffer;
        uniform float cameraNear;
        uniform float cameraFar;
        uniform float minDepthThreshold;
        uniform float maxDepthThreshold;
        uniform float depthScale;
        uniform float depthToBlurRatioBias;
        varying vec2 vUv;
        varying vec2 vUv0;
        varying vec2 vUv1;
        varying vec2 vUv2;
        varying vec2 vUv3;

        void main() {
          float depthFactor = 0.0;
          
          #ifdef USE_DEPTH
            vec4 depth = texture2D(depthBuffer, vUv);
            depthFactor = smoothstep(minDepthThreshold, maxDepthThreshold, 1.0-(depth.r * depth.a));
            depthFactor *= depthScale;
            depthFactor = max(0.0, min(1.0, depthFactor + 0.25));
          #endif
          
          vec4 sum = texture2D(inputBuffer, mix(vUv0, vUv, depthFactor));
          sum += texture2D(inputBuffer, mix(vUv1, vUv, depthFactor));
          sum += texture2D(inputBuffer, mix(vUv2, vUv, depthFactor));
          sum += texture2D(inputBuffer, mix(vUv3, vUv, depthFactor));
          gl_FragColor = sum * 0.25 ;

          #include <dithering_fragment>
          #include <tonemapping_fragment>
          #include <${l>=154?"colorspace_fragment":"encodings_fragment"}>
        }`,vertexShader:`uniform vec2 texelSize;
        uniform vec2 halfTexelSize;
        uniform float kernel;
        uniform float scale;
        varying vec2 vUv;
        varying vec2 vUv0;
        varying vec2 vUv1;
        varying vec2 vUv2;
        varying vec2 vUv3;

        void main() {
          vec2 uv = position.xy * 0.5 + 0.5;
          vUv = uv;

          vec2 dUv = (texelSize * vec2(kernel) + halfTexelSize) * scale;
          vUv0 = vec2(uv.x - dUv.x, uv.y + dUv.y);
          vUv1 = vec2(uv.x + dUv.x, uv.y + dUv.y);
          vUv2 = vec2(uv.x + dUv.x, uv.y - dUv.y);
          vUv3 = vec2(uv.x - dUv.x, uv.y - dUv.y);

          gl_Position = vec4(position.xy, 1.0, 1.0);
        }`,blending:a.XIg,depthWrite:!1,depthTest:!1}),this.toneMapped=!1,this.setTexelSize(e.x,e.y),this.kernel=new Float32Array([0,1,2,2,3])}setTexelSize(e,t){this.uniforms.texelSize.value.set(e,t),this.uniforms.halfTexelSize.value.set(e,t).multiplyScalar(.5)}setResolution(e){this.uniforms.resolution.value.copy(e)}}class u{constructor({gl:e,resolution:t,width:r=500,height:n=500,minDepthThreshold:i=0,maxDepthThreshold:o=1,depthScale:l=0,depthToBlurRatioBias:u=.25}){this.renderToScreen=!1,this.renderTargetA=new a.nWS(t,t,{minFilter:a.k6q,magFilter:a.k6q,stencilBuffer:!1,depthBuffer:!1,type:a.ix0}),this.renderTargetB=this.renderTargetA.clone(),this.convolutionMaterial=new s,this.convolutionMaterial.setTexelSize(1/r,1/n),this.convolutionMaterial.setResolution(new a.I9Y(r,n)),this.scene=new a.Z58,this.camera=new a.i7d,this.convolutionMaterial.uniforms.minDepthThreshold.value=i,this.convolutionMaterial.uniforms.maxDepthThreshold.value=o,this.convolutionMaterial.uniforms.depthScale.value=l,this.convolutionMaterial.uniforms.depthToBlurRatioBias.value=u,this.convolutionMaterial.defines.USE_DEPTH=l>0;let f=new Float32Array([-1,-1,0,3,-1,0,-1,3,0]),c=new Float32Array([0,0,2,0,0,2]),d=new a.LoY;d.setAttribute("position",new a.THS(f,3)),d.setAttribute("uv",new a.THS(c,2)),this.screen=new a.eaF(d,this.convolutionMaterial),this.screen.frustumCulled=!1,this.scene.add(this.screen)}render(e,t,r){let n,i,a,o=this.scene,l=this.camera,s=this.renderTargetA,u=this.renderTargetB,f=this.convolutionMaterial,c=f.uniforms;c.depthBuffer.value=t.depthTexture;let d=f.kernel,h=t;for(i=0,a=d.length-1;i<a;++i)n=(1&i)==0?s:u,c.kernel.value=d[i],c.inputBuffer.value=h.texture,e.setRenderTarget(n),e.render(o,l),h=n;c.kernel.value=d[i],c.inputBuffer.value=h.texture,e.setRenderTarget(this.renderToScreen?null:r),e.render(o,l)}}class f extends a._4j{constructor(e={}){super(e),this._tDepth={value:null},this._distortionMap={value:null},this._tDiffuse={value:null},this._tDiffuseBlur={value:null},this._textureMatrix={value:null},this._hasBlur={value:!1},this._mirror={value:0},this._mixBlur={value:0},this._blurStrength={value:.5},this._minDepthThreshold={value:.9},this._maxDepthThreshold={value:1},this._depthScale={value:0},this._depthToBlurRatioBias={value:.25},this._distortion={value:1},this._mixContrast={value:1},this.setValues(e)}onBeforeCompile(e){var t;null!=(t=e.defines)&&t.USE_UV||(e.defines.USE_UV=""),e.uniforms.hasBlur=this._hasBlur,e.uniforms.tDiffuse=this._tDiffuse,e.uniforms.tDepth=this._tDepth,e.uniforms.distortionMap=this._distortionMap,e.uniforms.tDiffuseBlur=this._tDiffuseBlur,e.uniforms.textureMatrix=this._textureMatrix,e.uniforms.mirror=this._mirror,e.uniforms.mixBlur=this._mixBlur,e.uniforms.mixStrength=this._blurStrength,e.uniforms.minDepthThreshold=this._minDepthThreshold,e.uniforms.maxDepthThreshold=this._maxDepthThreshold,e.uniforms.depthScale=this._depthScale,e.uniforms.depthToBlurRatioBias=this._depthToBlurRatioBias,e.uniforms.distortion=this._distortion,e.uniforms.mixContrast=this._mixContrast,e.vertexShader=`
        uniform mat4 textureMatrix;
        varying vec4 my_vUv;
      ${e.vertexShader}`,e.vertexShader=e.vertexShader.replace("#include <project_vertex>",`#include <project_vertex>
        my_vUv = textureMatrix * vec4( position, 1.0 );
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );`),e.fragmentShader=`
        uniform sampler2D tDiffuse;
        uniform sampler2D tDiffuseBlur;
        uniform sampler2D tDepth;
        uniform sampler2D distortionMap;
        uniform float distortion;
        uniform float cameraNear;
			  uniform float cameraFar;
        uniform bool hasBlur;
        uniform float mixBlur;
        uniform float mirror;
        uniform float mixStrength;
        uniform float minDepthThreshold;
        uniform float maxDepthThreshold;
        uniform float mixContrast;
        uniform float depthScale;
        uniform float depthToBlurRatioBias;
        varying vec4 my_vUv;
        ${e.fragmentShader}`,e.fragmentShader=e.fragmentShader.replace("#include <emissivemap_fragment>",`#include <emissivemap_fragment>

      float distortionFactor = 0.0;
      #ifdef USE_DISTORTION
        distortionFactor = texture2D(distortionMap, vUv).r * distortion;
      #endif

      vec4 new_vUv = my_vUv;
      new_vUv.x += distortionFactor;
      new_vUv.y += distortionFactor;

      vec4 base = texture2DProj(tDiffuse, new_vUv);
      vec4 blur = texture2DProj(tDiffuseBlur, new_vUv);

      vec4 merge = base;

      #ifdef USE_NORMALMAP
        vec2 normal_uv = vec2(0.0);
        vec4 normalColor = texture2D(normalMap, vUv * normalScale);
        vec3 my_normal = normalize( vec3( normalColor.r * 2.0 - 1.0, normalColor.b,  normalColor.g * 2.0 - 1.0 ) );
        vec3 coord = new_vUv.xyz / new_vUv.w;
        normal_uv = coord.xy + coord.z * my_normal.xz * 0.05;
        vec4 base_normal = texture2D(tDiffuse, normal_uv);
        vec4 blur_normal = texture2D(tDiffuseBlur, normal_uv);
        merge = base_normal;
        blur = blur_normal;
      #endif

      float depthFactor = 0.0001;
      float blurFactor = 0.0;

      #ifdef USE_DEPTH
        vec4 depth = texture2DProj(tDepth, new_vUv);
        depthFactor = smoothstep(minDepthThreshold, maxDepthThreshold, 1.0-(depth.r * depth.a));
        depthFactor *= depthScale;
        depthFactor = max(0.0001, min(1.0, depthFactor));

        #ifdef USE_BLUR
          blur = blur * min(1.0, depthFactor + depthToBlurRatioBias);
          merge = merge * min(1.0, depthFactor + 0.5);
        #else
          merge = merge * depthFactor;
        #endif

      #endif

      float reflectorRoughnessFactor = roughness;
      #ifdef USE_ROUGHNESSMAP
        vec4 reflectorTexelRoughness = texture2D( roughnessMap, vUv );
        reflectorRoughnessFactor *= reflectorTexelRoughness.g;
      #endif

      #ifdef USE_BLUR
        blurFactor = min(1.0, mixBlur * reflectorRoughnessFactor);
        merge = mix(merge, blur, blurFactor);
      #endif

      vec4 newMerge = vec4(0.0, 0.0, 0.0, 1.0);
      newMerge.r = (merge.r - 0.5) * mixContrast + 0.5;
      newMerge.g = (merge.g - 0.5) * mixContrast + 0.5;
      newMerge.b = (merge.b - 0.5) * mixContrast + 0.5;

      diffuseColor.rgb = diffuseColor.rgb * ((1.0 - min(1.0, mirror)) + newMerge.rgb * mixStrength);
      `)}get tDiffuse(){return this._tDiffuse.value}set tDiffuse(e){this._tDiffuse.value=e}get tDepth(){return this._tDepth.value}set tDepth(e){this._tDepth.value=e}get distortionMap(){return this._distortionMap.value}set distortionMap(e){this._distortionMap.value=e}get tDiffuseBlur(){return this._tDiffuseBlur.value}set tDiffuseBlur(e){this._tDiffuseBlur.value=e}get textureMatrix(){return this._textureMatrix.value}set textureMatrix(e){this._textureMatrix.value=e}get hasBlur(){return this._hasBlur.value}set hasBlur(e){this._hasBlur.value=e}get mirror(){return this._mirror.value}set mirror(e){this._mirror.value=e}get mixBlur(){return this._mixBlur.value}set mixBlur(e){this._mixBlur.value=e}get mixStrength(){return this._blurStrength.value}set mixStrength(e){this._blurStrength.value=e}get minDepthThreshold(){return this._minDepthThreshold.value}set minDepthThreshold(e){this._minDepthThreshold.value=e}get maxDepthThreshold(){return this._maxDepthThreshold.value}set maxDepthThreshold(e){this._maxDepthThreshold.value=e}get depthScale(){return this._depthScale.value}set depthScale(e){this._depthScale.value=e}get depthToBlurRatioBias(){return this._depthToBlurRatioBias.value}set depthToBlurRatioBias(e){this._depthToBlurRatioBias.value=e}get distortion(){return this._distortion.value}set distortion(e){this._distortion.value=e}get mixContrast(){return this._mixContrast.value}set mixContrast(e){this._mixContrast.value=e}}let c=i.forwardRef(({mixBlur:e=0,mixStrength:t=1,resolution:r=256,blur:l=[0,0],minDepthThreshold:s=.9,maxDepthThreshold:c=1,depthScale:d=0,depthToBlurRatioBias:h=.25,mirror:m=0,distortion:v=1,mixContrast:p=1,distortionMap:x,reflectorOffset:g=0,...w},b)=>{(0,o.e)({MeshReflectorMaterialImpl:f});let y=(0,o.C)(({gl:e})=>e),_=(0,o.C)(({camera:e})=>e),S=(0,o.C)(({scene:e})=>e),M=(l=Array.isArray(l)?l:[l,l])[0]+l[1]>0,T=l[0],D=l[1],B=i.useRef(null);i.useImperativeHandle(b,()=>B.current,[]);let[E]=i.useState(()=>new a.Zcv),[U]=i.useState(()=>new a.Pq0),[C]=i.useState(()=>new a.Pq0),[R]=i.useState(()=>new a.Pq0),[F]=i.useState(()=>new a.kn4),[P]=i.useState(()=>new a.Pq0(0,0,-1)),[k]=i.useState(()=>new a.IUQ),[j]=i.useState(()=>new a.Pq0),[z]=i.useState(()=>new a.Pq0),[I]=i.useState(()=>new a.IUQ),[O]=i.useState(()=>new a.kn4),[A]=i.useState(()=>new a.ubm),L=i.useCallback(()=>{var e;let t=B.current.parent||(null==(e=B.current)||null==(e=e.__r3f.parent)?void 0:e.object);if(!t||(C.setFromMatrixPosition(t.matrixWorld),R.setFromMatrixPosition(_.matrixWorld),F.extractRotation(t.matrixWorld),U.set(0,0,1),U.applyMatrix4(F),C.addScaledVector(U,g),j.subVectors(C,R),j.dot(U)>0))return;j.reflect(U).negate(),j.add(C),F.extractRotation(_.matrixWorld),P.set(0,0,-1),P.applyMatrix4(F),P.add(R),z.subVectors(C,P),z.reflect(U).negate(),z.add(C),A.position.copy(j),A.up.set(0,1,0),A.up.applyMatrix4(F),A.up.reflect(U),A.lookAt(z),A.far=_.far,A.updateMatrixWorld(),A.projectionMatrix.copy(_.projectionMatrix),O.set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1),O.multiply(A.projectionMatrix),O.multiply(A.matrixWorldInverse),O.multiply(t.matrixWorld),E.setFromNormalAndCoplanarPoint(U,C),E.applyMatrix4(A.matrixWorldInverse),k.set(E.normal.x,E.normal.y,E.normal.z,E.constant);let r=A.projectionMatrix;I.x=(Math.sign(k.x)+r.elements[8])/r.elements[0],I.y=(Math.sign(k.y)+r.elements[9])/r.elements[5],I.z=-1,I.w=(1+r.elements[10])/r.elements[14],k.multiplyScalar(2/k.dot(I)),r.elements[2]=k.x,r.elements[6]=k.y,r.elements[10]=k.z+1,r.elements[14]=k.w},[_,g]),[H,$,N,W]=i.useMemo(()=>{let n={minFilter:a.k6q,magFilter:a.k6q,type:a.ix0},i=new a.nWS(r,r,n);i.depthBuffer=!0,i.depthTexture=new a.VCu(r,r),i.depthTexture.format=a.zdS,i.depthTexture.type=a.cHt;let o=new a.nWS(r,r,n),l=new u({gl:y,resolution:r,width:T,height:D,minDepthThreshold:s,maxDepthThreshold:c,depthScale:d,depthToBlurRatioBias:h}),f={mirror:m,textureMatrix:O,mixBlur:e,tDiffuse:i.texture,tDepth:i.depthTexture,tDiffuseBlur:o.texture,hasBlur:M,mixStrength:t,minDepthThreshold:s,maxDepthThreshold:c,depthScale:d,depthToBlurRatioBias:h,distortion:v,distortionMap:x,mixContrast:p,"defines-USE_BLUR":M?"":void 0,"defines-USE_DEPTH":d>0?"":void 0,"defines-USE_DISTORTION":x?"":void 0};return[i,o,l,f]},[y,T,D,O,r,m,M,e,t,s,c,d,h,v,x,p]);return(0,o.D)(()=>{var e;let t=B.current.parent||(null==(e=B.current)||null==(e=e.__r3f.parent)?void 0:e.object);if(!t)return;t.visible=!1;let r=y.xr.enabled,n=y.shadowMap.autoUpdate;L(),y.xr.enabled=!1,y.shadowMap.autoUpdate=!1,y.setRenderTarget(H),y.state.buffers.depth.setMask(!0),y.autoClear||y.clear(),y.render(S,A),M&&N.render(y,H,$),y.xr.enabled=r,y.shadowMap.autoUpdate=n,t.visible=!0,y.setRenderTarget(null)}),i.createElement("meshReflectorMaterialImpl",n({attach:"material",key:"key"+W["defines-USE_BLUR"]+W["defines-USE_DEPTH"]+W["defines-USE_DISTORTION"],ref:B},W,w))})},8039:(e,t,r)=>{e.exports=r(5538)},8745:(e,t,r)=>{e.exports=r(7930)},9326:(e,t,r)=>{r.d(t,{DY:()=>o,IU:()=>s,uv:()=>l});let n=[];function i(e,t,r=(e,t)=>e===t){if(e===t)return!0;if(!e||!t)return!1;let n=e.length;if(t.length!==n)return!1;for(let i=0;i<n;i++)if(!r(e[i],t[i]))return!1;return!0}function a(e,t=null,r=!1,o={}){for(let a of(null===t&&(t=[e]),n))if(i(t,a.keys,a.equal)){if(r)return;if(Object.prototype.hasOwnProperty.call(a,"error"))throw a.error;if(Object.prototype.hasOwnProperty.call(a,"response"))return o.lifespan&&o.lifespan>0&&(a.timeout&&clearTimeout(a.timeout),a.timeout=setTimeout(a.remove,o.lifespan)),a.response;if(!r)throw a.promise}let l={keys:t,equal:o.equal,remove:()=>{let e=n.indexOf(l);-1!==e&&n.splice(e,1)},promise:("object"==typeof e&&"function"==typeof e.then?e:e(...t)).then(e=>{l.response=e,o.lifespan&&o.lifespan>0&&(l.timeout=setTimeout(l.remove,o.lifespan))}).catch(e=>l.error=e)};if(n.push(l),!r)throw l.promise}let o=(e,t,r)=>a(e,t,!1,r),l=(e,t,r)=>void a(e,t,!0,r),s=e=>{if(void 0===e||0===e.length)n.splice(0,n.length);else{let t=n.find(t=>i(e,t.keys,t.equal));t&&t.remove()}}},9348:(e,t,r)=>{r.d(t,{l:()=>i});var n=r(5269);class i extends n.Z58{constructor(){super();let e=new n.iNn;e.deleteAttribute("uv");let t=new n._4j({side:n.hsX}),r=new n._4j,i=new n.HiM(0xffffff,900,28,2);i.position.set(.418,16.199,.3),this.add(i);let o=new n.eaF(e,t);o.position.set(-.757,13.219,.717),o.scale.set(31.713,28.305,28.591),this.add(o);let l=new n.ZLX(e,r,6),s=new n.B69;s.position.set(-10.906,2.009,1.846),s.rotation.set(0,-.195,0),s.scale.set(2.328,7.905,4.651),s.updateMatrix(),l.setMatrixAt(0,s.matrix),s.position.set(-5.607,-.754,-.758),s.rotation.set(0,.994,0),s.scale.set(1.97,1.534,3.955),s.updateMatrix(),l.setMatrixAt(1,s.matrix),s.position.set(6.167,.857,7.803),s.rotation.set(0,.561,0),s.scale.set(3.927,6.285,3.687),s.updateMatrix(),l.setMatrixAt(2,s.matrix),s.position.set(-2.017,.018,6.124),s.rotation.set(0,.333,0),s.scale.set(2.002,4.566,2.064),s.updateMatrix(),l.setMatrixAt(3,s.matrix),s.position.set(2.291,-.756,-2.621),s.rotation.set(0,-.286,0),s.scale.set(1.546,1.552,1.496),s.updateMatrix(),l.setMatrixAt(4,s.matrix),s.position.set(-2.193,-.369,-5.547),s.rotation.set(0,.516,0),s.scale.set(3.875,3.487,2.986),s.updateMatrix(),l.setMatrixAt(5,s.matrix),this.add(l);let u=new n.eaF(e,a(50));u.position.set(-16.116,14.37,8.208),u.scale.set(.1,2.428,2.739),this.add(u);let f=new n.eaF(e,a(50));f.position.set(-16.109,18.021,-8.207),f.scale.set(.1,2.425,2.751),this.add(f);let c=new n.eaF(e,a(17));c.position.set(14.904,12.198,-1.832),c.scale.set(.15,4.265,6.331),this.add(c);let d=new n.eaF(e,a(43));d.position.set(-.462,8.89,14.52),d.scale.set(4.38,5.441,.088),this.add(d);let h=new n.eaF(e,a(20));h.position.set(3.235,11.486,-12.541),h.scale.set(2.5,2,.1),this.add(h);let m=new n.eaF(e,a(100));m.position.set(0,20,0),m.scale.set(1,.1,1),this.add(m)}dispose(){let e=new Set;for(let t of(this.traverse(t=>{t.isMesh&&(e.add(t.geometry),e.add(t.material))}),e))t.dispose()}}function a(e){return new n.G_z({color:0,emissive:0xffffff,emissiveIntensity:e})}},9617:(e,t,r)=>{var n=r(2115),i=r(8039),a="function"==typeof Object.is?Object.is:function(e,t){return e===t&&(0!==e||1/e==1/t)||e!=e&&t!=t},o=i.useSyncExternalStore,l=n.useRef,s=n.useEffect,u=n.useMemo,f=n.useDebugValue;t.useSyncExternalStoreWithSelector=function(e,t,r,n,i){var c=l(null);if(null===c.current){var d={hasValue:!1,value:null};c.current=d}else d=c.current;var h=o(e,(c=u(function(){function e(e){if(!s){if(s=!0,o=e,e=n(e),void 0!==i&&d.hasValue){var t=d.value;if(i(t,e))return l=t}return l=e}if(t=l,a(o,e))return t;var r=n(e);return void 0!==i&&i(t,r)?(o=e,t):(o=e,l=r)}var o,l,s=!1,u=void 0===r?null:r;return[function(){return e(t())},null===u?void 0:function(){return e(u())}]},[t,r,n,i]))[0],c[1]);return s(function(){d.hasValue=!0,d.value=h},[h]),f(h),h}}}]);