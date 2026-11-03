"use strict";(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[943],{425:(e,t,n)=>{n.d(t,{A:()=>l});var r=n(2115);let i=(...e)=>e.filter((e,t,n)=>!!e&&""!==e.trim()&&n.indexOf(e)===t).join(" ").trim(),o=e=>{let t=e.replace(/^([A-Z])|[\s-_]+(\w)/g,(e,t,n)=>n?n.toUpperCase():t.toLowerCase());return t.charAt(0).toUpperCase()+t.slice(1)};var a={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:2,strokeLinecap:"round",strokeLinejoin:"round"};let s=(0,r.forwardRef)(({color:e="currentColor",size:t=24,strokeWidth:n=2,absoluteStrokeWidth:o,className:s="",children:l,iconNode:u,...c},f)=>(0,r.createElement)("svg",{ref:f,...a,width:t,height:t,stroke:e,strokeWidth:o?24*Number(n)/Number(t):n,className:i("lucide",s),...!l&&!(e=>{for(let t in e)if(t.startsWith("aria-")||"role"===t||"title"===t)return!0;return!1})(c)&&{"aria-hidden":"true"},...c},[...u.map(([e,t])=>(0,r.createElement)(e,t)),...Array.isArray(l)?l:[l]])),l=(e,t)=>{let n=(0,r.forwardRef)(({className:n,...a},l)=>(0,r.createElement)(s,{ref:l,iconNode:t,className:i(`lucide-${o(e).replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase()}`,`lucide-${e}`,n),...a}));return n.displayName=o(e),n}},439:(e,t,n)=>{n.d(t,{A:()=>r});let r=(0,n(425).A)("shield",[["path",{d:"M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z",key:"oel41y"}]])},762:(e,t,n)=>{n.d(t,{A:()=>r});let r=(0,n(425).A)("terminal",[["path",{d:"M12 19h8",key:"baeox8"}],["path",{d:"m4 17 6-6-6-6",key:"1yngyt"}]])},1333:(e,t,n)=>{n.d(t,{s:()=>p});var r=n(5672),i=n(2115),o=n(5269),a=n(9590);let s=parseInt(o.sPf.replace(/\D+/g,""));class l extends o.BKk{constructor(){super({uniforms:{time:{value:0},pixelRatio:{value:1}},vertexShader:`
        uniform float pixelRatio;
        uniform float time;
        attribute float size;  
        attribute float speed;  
        attribute float opacity;
        attribute vec3 noise;
        attribute vec3 color;
        varying vec3 vColor;
        varying float vOpacity;

        void main() {
          vec4 modelPosition = modelMatrix * vec4(position, 1.0);
          modelPosition.y += sin(time * speed + modelPosition.x * noise.x * 100.0) * 0.2;
          modelPosition.z += cos(time * speed + modelPosition.x * noise.y * 100.0) * 0.2;
          modelPosition.x += cos(time * speed + modelPosition.x * noise.z * 100.0) * 0.2;
          vec4 viewPosition = viewMatrix * modelPosition;
          vec4 projectionPostion = projectionMatrix * viewPosition;
          gl_Position = projectionPostion;
          gl_PointSize = size * 25. * pixelRatio;
          gl_PointSize *= (1.0 / - viewPosition.z);
          vColor = color;
          vOpacity = opacity;
        }
      `,fragmentShader:`
        varying vec3 vColor;
        varying float vOpacity;
        void main() {
          float distanceToCenter = distance(gl_PointCoord, vec2(0.5));
          float strength = 0.05 / distanceToCenter - 0.1;
          gl_FragColor = vec4(vColor, strength * vOpacity);
          #include <tonemapping_fragment>
          #include <${s>=154?"colorspace_fragment":"encodings_fragment"}>
        }
      `})}get time(){return this.uniforms.time.value}set time(e){this.uniforms.time.value=e}get pixelRatio(){return this.uniforms.pixelRatio.value}set pixelRatio(e){this.uniforms.pixelRatio.value=e}}let u=e=>e&&e.constructor===Float32Array,c=e=>e instanceof o.I9Y||e instanceof o.Pq0||e instanceof o.IUQ,f=e=>Array.isArray(e)?e:c(e)?e.toArray():[e,e,e];function d(e,t,n){return i.useMemo(()=>{if(void 0!==t)if(u(t))return t;else{if(t instanceof o.Q1f){let n=Array.from({length:3*e},()=>[t.r,t.g,t.b]).flat();return Float32Array.from(n)}if(c(t)||Array.isArray(t)){let n=Array.from({length:3*e},()=>f(t)).flat();return Float32Array.from(n)}return Float32Array.from({length:e},()=>t)}return Float32Array.from({length:e},n)},[t])}let p=i.forwardRef(({noise:e=1,count:t=100,speed:n=1,opacity:s=1,scale:c=1,size:p,color:m,children:h,...v},y)=>{i.useMemo(()=>(0,a.e)({SparklesImplMaterial:l}),[]);let w=i.useRef(null),g=(0,a.C)(e=>e.viewport.dpr),x=f(c),b=i.useMemo(()=>Float32Array.from(Array.from({length:t},()=>x.map(o.cj9.randFloatSpread)).flat()),[t,...x]),S=d(t,p,Math.random),_=d(t,s),A=d(t,n),M=d(3*t,e),E=d(void 0===m?3*t:t,u(m)?m:new o.Q1f(m),()=>1);return(0,a.D)(e=>{w.current&&w.current.material&&(w.current.material.time=e.clock.elapsedTime)}),i.useImperativeHandle(y,()=>w.current,[]),i.createElement("points",(0,r.A)({key:`particle-${t}-${JSON.stringify(c)}`},v,{ref:w}),i.createElement("bufferGeometry",null,i.createElement("bufferAttribute",{attach:"attributes-position",args:[b,3]}),i.createElement("bufferAttribute",{attach:"attributes-size",args:[S,1]}),i.createElement("bufferAttribute",{attach:"attributes-opacity",args:[_,1]}),i.createElement("bufferAttribute",{attach:"attributes-speed",args:[A,1]}),i.createElement("bufferAttribute",{attach:"attributes-color",args:[E,3]}),i.createElement("bufferAttribute",{attach:"attributes-noise",args:[M,3]})),h||i.createElement("sparklesImplMaterial",{transparent:!0,pixelRatio:g,depthWrite:!1}))})},1336:(e,t,n)=>{n.d(t,{o:()=>i});var r=n(5269);class i{constructor(){this.isPass=!0,this.enabled=!0,this.needsSwap=!0,this.clear=!1,this.renderToScreen=!1}setSize(){}render(){console.error("THREE.Pass: .render() must be implemented in derived pass.")}dispose(){}}new r.qUd(-1,1,1,-1,0,1);class o extends r.LoY{constructor(){super(),this.setAttribute("position",new r.qtW([-1,3,0,-1,-1,0,3,-1,0],3)),this.setAttribute("uv",new r.qtW([0,2,0,0,2,0],2))}}new o},1407:(e,t,n)=>{n.d(t,{A:()=>r});let r=(0,n(425).A)("cloud",[["path",{d:"M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z",key:"p7xjir"}]])},1501:(e,t,n)=>{n.d(t,{h:()=>l});var r=n(2115),i=n(4577),o=n(5867);let{useSyncExternalStoreWithSelector:a}=i,s=(e,t)=>{let n=(0,o.y)(e),i=(e,i=t)=>(function(e,t=e=>e,n){let i=a(e.subscribe,e.getState,e.getInitialState,t,n);return r.useDebugValue(i),i})(n,e,i);return Object.assign(i,n),i},l=(e,t)=>e?s(e,t):s},1535:(e,t,n)=>{n.d(t,{v:()=>a});var r=n(2115),i=n(5867);let o=e=>{let t=(0,i.y)(e),n=e=>(function(e,t=e=>e){let n=r.useSyncExternalStore(e.subscribe,r.useCallback(()=>t(e.getState()),[e,t]),r.useCallback(()=>t(e.getInitialState()),[e,t]));return r.useDebugValue(n),n})(t,e);return Object.assign(n,t),n},a=e=>e?o(e):o},1628:(e,t,n)=>{n.d(t,{A:()=>r});let r=(0,n(425).A)("arrow-right",[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"m12 5 7 7-7 7",key:"xquz4c"}]])},2055:(e,t,n)=>{n.d(t,{A:()=>r});let r=(0,n(425).A)("arrow-up",[["path",{d:"m5 12 7-7 7 7",key:"hav0vg"}],["path",{d:"M12 19V5",key:"x0mq9r"}]])},2484:(e,t,n)=>{n.d(t,{A:()=>r});let r=(0,n(425).A)("circle-check-big",[["path",{d:"M21.801 10A10 10 0 1 1 17 3.335",key:"yps3ct"}],["path",{d:"m9 11 3 3L22 4",key:"1pflzl"}]])},3210:(e,t,n)=>{n.d(t,{A:()=>r});let r=(0,n(425).A)("x",[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]])},3283:(e,t,n)=>{let r,i;n.d(t,{N:()=>R});var o=n(5672),a=n(2115),s=n(5269),l=n(9590);let u=new s.NRn,c=new s.Pq0;class f extends s.CmU{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type="LineSegmentsGeometry",this.setIndex([0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5]),this.setAttribute("position",new s.qtW([-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],3)),this.setAttribute("uv",new s.qtW([-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],2))}applyMatrix4(e){let t=this.attributes.instanceStart,n=this.attributes.instanceEnd;return void 0!==t&&(t.applyMatrix4(e),n.applyMatrix4(e),t.needsUpdate=!0),null!==this.boundingBox&&this.computeBoundingBox(),null!==this.boundingSphere&&this.computeBoundingSphere(),this}setPositions(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));let n=new s.LuO(t,6,1);return this.setAttribute("instanceStart",new s.eHs(n,3,0)),this.setAttribute("instanceEnd",new s.eHs(n,3,3)),this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(e,t=3){let n;e instanceof Float32Array?n=e:Array.isArray(e)&&(n=new Float32Array(e));let r=new s.LuO(n,2*t,1);return this.setAttribute("instanceColorStart",new s.eHs(r,t,0)),this.setAttribute("instanceColorEnd",new s.eHs(r,t,t)),this}fromWireframeGeometry(e){return this.setPositions(e.attributes.position.array),this}fromEdgesGeometry(e){return this.setPositions(e.attributes.position.array),this}fromMesh(e){return this.fromWireframeGeometry(new s.XJ7(e.geometry)),this}fromLineSegments(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}computeBoundingBox(){null===this.boundingBox&&(this.boundingBox=new s.NRn);let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;void 0!==e&&void 0!==t&&(this.boundingBox.setFromBufferAttribute(e),u.setFromBufferAttribute(t),this.boundingBox.union(u))}computeBoundingSphere(){null===this.boundingSphere&&(this.boundingSphere=new s.iyt),null===this.boundingBox&&this.computeBoundingBox();let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;if(void 0!==e&&void 0!==t){let n=this.boundingSphere.center;this.boundingBox.getCenter(n);let r=0;for(let i=0,o=e.count;i<o;i++)c.fromBufferAttribute(e,i),r=Math.max(r,n.distanceToSquared(c)),c.fromBufferAttribute(t,i),r=Math.max(r,n.distanceToSquared(c));this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&console.error("THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.",this)}}toJSON(){}applyMatrix(e){return console.warn("THREE.LineSegmentsGeometry: applyMatrix() has been renamed to applyMatrix4()."),this.applyMatrix4(e)}}var d=n(9625);let p=parseInt(s.sPf.replace(/\D+/g,""));class m extends s.BKk{constructor(e){super({type:"LineMaterial",uniforms:s.LlO.clone(s.LlO.merge([d.UniformsLib.common,d.UniformsLib.fog,{worldUnits:{value:1},linewidth:{value:1},resolution:{value:new s.I9Y(1,1)},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}}])),vertexShader:`
				#include <common>
				#include <fog_pars_vertex>
				#include <logdepthbuf_pars_vertex>
				#include <clipping_planes_pars_vertex>

				uniform float linewidth;
				uniform vec2 resolution;

				attribute vec3 instanceStart;
				attribute vec3 instanceEnd;

				#ifdef USE_COLOR
					#ifdef USE_LINE_COLOR_ALPHA
						varying vec4 vLineColor;
						attribute vec4 instanceColorStart;
						attribute vec4 instanceColorEnd;
					#else
						varying vec3 vLineColor;
						attribute vec3 instanceColorStart;
						attribute vec3 instanceColorEnd;
					#endif
				#endif

				#ifdef WORLD_UNITS

					varying vec4 worldPos;
					varying vec3 worldStart;
					varying vec3 worldEnd;

					#ifdef USE_DASH

						varying vec2 vUv;

					#endif

				#else

					varying vec2 vUv;

				#endif

				#ifdef USE_DASH

					uniform float dashScale;
					attribute float instanceDistanceStart;
					attribute float instanceDistanceEnd;
					varying float vLineDistance;

				#endif

				void trimSegment( const in vec4 start, inout vec4 end ) {

					// trim end segment so it terminates between the camera plane and the near plane

					// conservative estimate of the near plane
					float a = projectionMatrix[ 2 ][ 2 ]; // 3nd entry in 3th column
					float b = projectionMatrix[ 3 ][ 2 ]; // 3nd entry in 4th column
					float nearEstimate = - 0.5 * b / a;

					float alpha = ( nearEstimate - start.z ) / ( end.z - start.z );

					end.xyz = mix( start.xyz, end.xyz, alpha );

				}

				void main() {

					#ifdef USE_COLOR

						vLineColor = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;

					#endif

					#ifdef USE_DASH

						vLineDistance = ( position.y < 0.5 ) ? dashScale * instanceDistanceStart : dashScale * instanceDistanceEnd;
						vUv = uv;

					#endif

					float aspect = resolution.x / resolution.y;

					// camera space
					vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
					vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );

					#ifdef WORLD_UNITS

						worldStart = start.xyz;
						worldEnd = end.xyz;

					#else

						vUv = uv;

					#endif

					// special case for perspective projection, and segments that terminate either in, or behind, the camera plane
					// clearly the gpu firmware has a way of addressing this issue when projecting into ndc space
					// but we need to perform ndc-space calculations in the shader, so we must address this issue directly
					// perhaps there is a more elegant solution -- WestLangley

					bool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 ); // 4th entry in the 3rd column

					if ( perspective ) {

						if ( start.z < 0.0 && end.z >= 0.0 ) {

							trimSegment( start, end );

						} else if ( end.z < 0.0 && start.z >= 0.0 ) {

							trimSegment( end, start );

						}

					}

					// clip space
					vec4 clipStart = projectionMatrix * start;
					vec4 clipEnd = projectionMatrix * end;

					// ndc space
					vec3 ndcStart = clipStart.xyz / clipStart.w;
					vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

					// direction
					vec2 dir = ndcEnd.xy - ndcStart.xy;

					// account for clip-space aspect ratio
					dir.x *= aspect;
					dir = normalize( dir );

					#ifdef WORLD_UNITS

						// get the offset direction as perpendicular to the view vector
						vec3 worldDir = normalize( end.xyz - start.xyz );
						vec3 offset;
						if ( position.y < 0.5 ) {

							offset = normalize( cross( start.xyz, worldDir ) );

						} else {

							offset = normalize( cross( end.xyz, worldDir ) );

						}

						// sign flip
						if ( position.x < 0.0 ) offset *= - 1.0;

						float forwardOffset = dot( worldDir, vec3( 0.0, 0.0, 1.0 ) );

						// don't extend the line if we're rendering dashes because we
						// won't be rendering the endcaps
						#ifndef USE_DASH

							// extend the line bounds to encompass  endcaps
							start.xyz += - worldDir * linewidth * 0.5;
							end.xyz += worldDir * linewidth * 0.5;

							// shift the position of the quad so it hugs the forward edge of the line
							offset.xy -= dir * forwardOffset;
							offset.z += 0.5;

						#endif

						// endcaps
						if ( position.y > 1.0 || position.y < 0.0 ) {

							offset.xy += dir * 2.0 * forwardOffset;

						}

						// adjust for linewidth
						offset *= linewidth * 0.5;

						// set the world position
						worldPos = ( position.y < 0.5 ) ? start : end;
						worldPos.xyz += offset;

						// project the worldpos
						vec4 clip = projectionMatrix * worldPos;

						// shift the depth of the projected points so the line
						// segments overlap neatly
						vec3 clipPose = ( position.y < 0.5 ) ? ndcStart : ndcEnd;
						clip.z = clipPose.z * clip.w;

					#else

						vec2 offset = vec2( dir.y, - dir.x );
						// undo aspect ratio adjustment
						dir.x /= aspect;
						offset.x /= aspect;

						// sign flip
						if ( position.x < 0.0 ) offset *= - 1.0;

						// endcaps
						if ( position.y < 0.0 ) {

							offset += - dir;

						} else if ( position.y > 1.0 ) {

							offset += dir;

						}

						// adjust for linewidth
						offset *= linewidth;

						// adjust for clip-space to screen-space conversion // maybe resolution should be based on viewport ...
						offset /= resolution.y;

						// select end
						vec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;

						// back to clip space
						offset *= clip.w;

						clip.xy += offset;

					#endif

					gl_Position = clip;

					vec4 mvPosition = ( position.y < 0.5 ) ? start : end; // this is an approximation

					#include <logdepthbuf_vertex>
					#include <clipping_planes_vertex>
					#include <fog_vertex>

				}
			`,fragmentShader:`
				uniform vec3 diffuse;
				uniform float opacity;
				uniform float linewidth;

				#ifdef USE_DASH

					uniform float dashOffset;
					uniform float dashSize;
					uniform float gapSize;

				#endif

				varying float vLineDistance;

				#ifdef WORLD_UNITS

					varying vec4 worldPos;
					varying vec3 worldStart;
					varying vec3 worldEnd;

					#ifdef USE_DASH

						varying vec2 vUv;

					#endif

				#else

					varying vec2 vUv;

				#endif

				#include <common>
				#include <fog_pars_fragment>
				#include <logdepthbuf_pars_fragment>
				#include <clipping_planes_pars_fragment>

				#ifdef USE_COLOR
					#ifdef USE_LINE_COLOR_ALPHA
						varying vec4 vLineColor;
					#else
						varying vec3 vLineColor;
					#endif
				#endif

				vec2 closestLineToLine(vec3 p1, vec3 p2, vec3 p3, vec3 p4) {

					float mua;
					float mub;

					vec3 p13 = p1 - p3;
					vec3 p43 = p4 - p3;

					vec3 p21 = p2 - p1;

					float d1343 = dot( p13, p43 );
					float d4321 = dot( p43, p21 );
					float d1321 = dot( p13, p21 );
					float d4343 = dot( p43, p43 );
					float d2121 = dot( p21, p21 );

					float denom = d2121 * d4343 - d4321 * d4321;

					float numer = d1343 * d4321 - d1321 * d4343;

					mua = numer / denom;
					mua = clamp( mua, 0.0, 1.0 );
					mub = ( d1343 + d4321 * ( mua ) ) / d4343;
					mub = clamp( mub, 0.0, 1.0 );

					return vec2( mua, mub );

				}

				void main() {

					#include <clipping_planes_fragment>

					#ifdef USE_DASH

						if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard; // discard endcaps

						if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX

					#endif

					float alpha = opacity;

					#ifdef WORLD_UNITS

						// Find the closest points on the view ray and the line segment
						vec3 rayEnd = normalize( worldPos.xyz ) * 1e5;
						vec3 lineDir = worldEnd - worldStart;
						vec2 params = closestLineToLine( worldStart, worldEnd, vec3( 0.0, 0.0, 0.0 ), rayEnd );

						vec3 p1 = worldStart + lineDir * params.x;
						vec3 p2 = rayEnd * params.y;
						vec3 delta = p1 - p2;
						float len = length( delta );
						float norm = len / linewidth;

						#ifndef USE_DASH

							#ifdef USE_ALPHA_TO_COVERAGE

								float dnorm = fwidth( norm );
								alpha = 1.0 - smoothstep( 0.5 - dnorm, 0.5 + dnorm, norm );

							#else

								if ( norm > 0.5 ) {

									discard;

								}

							#endif

						#endif

					#else

						#ifdef USE_ALPHA_TO_COVERAGE

							// artifacts appear on some hardware if a derivative is taken within a conditional
							float a = vUv.x;
							float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
							float len2 = a * a + b * b;
							float dlen = fwidth( len2 );

							if ( abs( vUv.y ) > 1.0 ) {

								alpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );

							}

						#else

							if ( abs( vUv.y ) > 1.0 ) {

								float a = vUv.x;
								float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
								float len2 = a * a + b * b;

								if ( len2 > 1.0 ) discard;

							}

						#endif

					#endif

					vec4 diffuseColor = vec4( diffuse, alpha );
					#ifdef USE_COLOR
						#ifdef USE_LINE_COLOR_ALPHA
							diffuseColor *= vLineColor;
						#else
							diffuseColor.rgb *= vLineColor;
						#endif
					#endif

					#include <logdepthbuf_fragment>

					gl_FragColor = diffuseColor;

					#include <tonemapping_fragment>
					#include <${p>=154?"colorspace_fragment":"encodings_fragment"}>
					#include <fog_fragment>
					#include <premultiplied_alpha_fragment>

				}
			`,clipping:!0}),this.isLineMaterial=!0,this.onBeforeCompile=function(){this.transparent?this.defines.USE_LINE_COLOR_ALPHA="1":delete this.defines.USE_LINE_COLOR_ALPHA},Object.defineProperties(this,{color:{enumerable:!0,get:function(){return this.uniforms.diffuse.value},set:function(e){this.uniforms.diffuse.value=e}},worldUnits:{enumerable:!0,get:function(){return"WORLD_UNITS"in this.defines},set:function(e){!0===e?this.defines.WORLD_UNITS="":delete this.defines.WORLD_UNITS}},linewidth:{enumerable:!0,get:function(){return this.uniforms.linewidth.value},set:function(e){this.uniforms.linewidth.value=e}},dashed:{enumerable:!0,get:function(){return"USE_DASH"in this.defines},set(e){!!e!="USE_DASH"in this.defines&&(this.needsUpdate=!0),!0===e?this.defines.USE_DASH="":delete this.defines.USE_DASH}},dashScale:{enumerable:!0,get:function(){return this.uniforms.dashScale.value},set:function(e){this.uniforms.dashScale.value=e}},dashSize:{enumerable:!0,get:function(){return this.uniforms.dashSize.value},set:function(e){this.uniforms.dashSize.value=e}},dashOffset:{enumerable:!0,get:function(){return this.uniforms.dashOffset.value},set:function(e){this.uniforms.dashOffset.value=e}},gapSize:{enumerable:!0,get:function(){return this.uniforms.gapSize.value},set:function(e){this.uniforms.gapSize.value=e}},opacity:{enumerable:!0,get:function(){return this.uniforms.opacity.value},set:function(e){this.uniforms.opacity.value=e}},resolution:{enumerable:!0,get:function(){return this.uniforms.resolution.value},set:function(e){this.uniforms.resolution.value.copy(e)}},alphaToCoverage:{enumerable:!0,get:function(){return"USE_ALPHA_TO_COVERAGE"in this.defines},set:function(e){!!e!="USE_ALPHA_TO_COVERAGE"in this.defines&&(this.needsUpdate=!0),!0===e?(this.defines.USE_ALPHA_TO_COVERAGE="",this.extensions.derivatives=!0):(delete this.defines.USE_ALPHA_TO_COVERAGE,this.extensions.derivatives=!1)}}}),this.setValues(e)}}let h=p>=125?"uv1":"uv2",v=new s.IUQ,y=new s.Pq0,w=new s.Pq0,g=new s.IUQ,x=new s.IUQ,b=new s.IUQ,S=new s.Pq0,_=new s.kn4,A=new s.cZY,M=new s.Pq0,E=new s.NRn,P=new s.iyt,z=new s.IUQ;function L(e,t,n){return z.set(0,0,-t,1).applyMatrix4(e.projectionMatrix),z.multiplyScalar(1/z.w),z.x=i/n.width,z.y=i/n.height,z.applyMatrix4(e.projectionMatrixInverse),z.multiplyScalar(1/z.w),Math.abs(Math.max(z.x,z.y))}class C extends s.eaF{constructor(e=new f,t=new m({color:0xffffff*Math.random()})){super(e,t),this.isLineSegments2=!0,this.type="LineSegments2"}computeLineDistances(){let e=this.geometry,t=e.attributes.instanceStart,n=e.attributes.instanceEnd,r=new Float32Array(2*t.count);for(let e=0,i=0,o=t.count;e<o;e++,i+=2)y.fromBufferAttribute(t,e),w.fromBufferAttribute(n,e),r[i]=0===i?0:r[i-1],r[i+1]=r[i]+y.distanceTo(w);let i=new s.LuO(r,2,1);return e.setAttribute("instanceDistanceStart",new s.eHs(i,1,0)),e.setAttribute("instanceDistanceEnd",new s.eHs(i,1,1)),this}raycast(e,t){let n,o,a=this.material.worldUnits,l=e.camera;null!==l||a||console.error('LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.');let u=void 0!==e.params.Line2&&e.params.Line2.threshold||0;r=e.ray;let c=this.matrixWorld,f=this.geometry,d=this.material;if(i=d.linewidth+u,null===f.boundingSphere&&f.computeBoundingSphere(),P.copy(f.boundingSphere).applyMatrix4(c),a)n=.5*i;else{let e=Math.max(l.near,P.distanceToPoint(r.origin));n=L(l,e,d.resolution)}if(P.radius+=n,!1!==r.intersectsSphere(P)){if(null===f.boundingBox&&f.computeBoundingBox(),E.copy(f.boundingBox).applyMatrix4(c),a)o=.5*i;else{let e=Math.max(l.near,E.distanceToPoint(r.origin));o=L(l,e,d.resolution)}E.expandByScalar(o),!1!==r.intersectsBox(E)&&(a?function(e,t){let n=e.matrixWorld,o=e.geometry,a=o.attributes.instanceStart,l=o.attributes.instanceEnd,u=Math.min(o.instanceCount,a.count);for(let o=0;o<u;o++){A.start.fromBufferAttribute(a,o),A.end.fromBufferAttribute(l,o),A.applyMatrix4(n);let u=new s.Pq0,c=new s.Pq0;r.distanceSqToSegment(A.start,A.end,c,u),c.distanceTo(u)<.5*i&&t.push({point:c,pointOnLine:u,distance:r.origin.distanceTo(c),object:e,face:null,faceIndex:o,uv:null,[h]:null})}}(this,t):function(e,t,n){let o=t.projectionMatrix,a=e.material.resolution,l=e.matrixWorld,u=e.geometry,c=u.attributes.instanceStart,f=u.attributes.instanceEnd,d=Math.min(u.instanceCount,c.count),p=-t.near;r.at(1,b),b.w=1,b.applyMatrix4(t.matrixWorldInverse),b.applyMatrix4(o),b.multiplyScalar(1/b.w),b.x*=a.x/2,b.y*=a.y/2,b.z=0,S.copy(b),_.multiplyMatrices(t.matrixWorldInverse,l);for(let t=0;t<d;t++){if(g.fromBufferAttribute(c,t),x.fromBufferAttribute(f,t),g.w=1,x.w=1,g.applyMatrix4(_),x.applyMatrix4(_),g.z>p&&x.z>p)continue;if(g.z>p){let e=g.z-x.z,t=(g.z-p)/e;g.lerp(x,t)}else if(x.z>p){let e=x.z-g.z,t=(x.z-p)/e;x.lerp(g,t)}g.applyMatrix4(o),x.applyMatrix4(o),g.multiplyScalar(1/g.w),x.multiplyScalar(1/x.w),g.x*=a.x/2,g.y*=a.y/2,x.x*=a.x/2,x.y*=a.y/2,A.start.copy(g),A.start.z=0,A.end.copy(x),A.end.z=0;let u=A.closestPointToPointParameter(S,!0);A.at(u,M);let d=s.cj9.lerp(g.z,x.z,u),m=d>=-1&&d<=1,v=S.distanceTo(M)<.5*i;if(m&&v){A.start.fromBufferAttribute(c,t),A.end.fromBufferAttribute(f,t),A.start.applyMatrix4(l),A.end.applyMatrix4(l);let i=new s.Pq0,o=new s.Pq0;r.distanceSqToSegment(A.start,A.end,o,i),n.push({point:o,pointOnLine:i,distance:r.origin.distanceTo(o),object:e,face:null,faceIndex:t,uv:null,[h]:null})}}}(this,l,t))}}onBeforeRender(e){let t=this.material.uniforms;t&&t.resolution&&(e.getViewport(v),this.material.uniforms.resolution.value.set(v.z,v.w))}}class k extends f{constructor(){super(),this.isLineGeometry=!0,this.type="LineGeometry"}setPositions(e){let t=e.length-3,n=new Float32Array(2*t);for(let r=0;r<t;r+=3)n[2*r]=e[r],n[2*r+1]=e[r+1],n[2*r+2]=e[r+2],n[2*r+3]=e[r+3],n[2*r+4]=e[r+4],n[2*r+5]=e[r+5];return super.setPositions(n),this}setColors(e,t=3){let n=e.length-t,r=new Float32Array(2*n);if(3===t)for(let i=0;i<n;i+=t)r[2*i]=e[i],r[2*i+1]=e[i+1],r[2*i+2]=e[i+2],r[2*i+3]=e[i+3],r[2*i+4]=e[i+4],r[2*i+5]=e[i+5];else for(let i=0;i<n;i+=t)r[2*i]=e[i],r[2*i+1]=e[i+1],r[2*i+2]=e[i+2],r[2*i+3]=e[i+3],r[2*i+4]=e[i+4],r[2*i+5]=e[i+5],r[2*i+6]=e[i+6],r[2*i+7]=e[i+7];return super.setColors(r,t),this}fromLine(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}}class O extends C{constructor(e=new k,t=new m({color:0xffffff*Math.random()})){super(e,t),this.isLine2=!0,this.type="Line2"}}let R=a.forwardRef(function({points:e,color:t=0xffffff,vertexColors:n,linewidth:r,lineWidth:i,segments:u,dashed:c,...d},p){var h,v;let y=(0,l.C)(e=>e.size),w=a.useMemo(()=>u?new C:new O,[u]),[g]=a.useState(()=>new m),x=(null==n||null==(h=n[0])?void 0:h.length)===4?4:3,b=a.useMemo(()=>{let r=u?new f:new k,i=e.map(e=>{let t=Array.isArray(e);return e instanceof s.Pq0||e instanceof s.IUQ?[e.x,e.y,e.z]:e instanceof s.I9Y?[e.x,e.y,0]:t&&3===e.length?[e[0],e[1],e[2]]:t&&2===e.length?[e[0],e[1],0]:e});if(r.setPositions(i.flat()),n){t=0xffffff;let e=n.map(e=>e instanceof s.Q1f?e.toArray():e);r.setColors(e.flat(),x)}return r},[e,u,n,x]);return a.useLayoutEffect(()=>{w.computeLineDistances()},[e,w]),a.useLayoutEffect(()=>{c?g.defines.USE_DASH="":delete g.defines.USE_DASH,g.needsUpdate=!0},[c,g]),a.useEffect(()=>()=>{b.dispose(),g.dispose()},[b]),a.createElement("primitive",(0,o.A)({object:w,ref:p},d),a.createElement("primitive",{object:b,attach:"geometry"}),a.createElement("primitive",(0,o.A)({object:g,attach:"material",color:t,vertexColors:!!n,resolution:[y.width,y.height],linewidth:null!=(v=null!=r?r:i)?v:1,dashed:c,transparent:4===x},d)))})},3545:(e,t,n)=>{n.d(t,{A:()=>r});let r=(0,n(425).A)("circle-alert",[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["line",{x1:"12",x2:"12",y1:"8",y2:"12",key:"1pkeuh"}],["line",{x1:"12",x2:"12.01",y1:"16",y2:"16",key:"4dfq90"}]])},4071:(e,t,n)=>{n.d(t,{A:()=>r});let r=(0,n(425).A)("trending-up",[["path",{d:"M16 7h6v6",key:"box55l"}],["path",{d:"m22 7-8.5 8.5-5-5L2 17",key:"1t1m79"}]])},4400:(e,t,n)=>{n.d(t,{Af:()=>u,Nz:()=>a,u5:()=>c,y3:()=>p});var r,i,o=n(2115);function a(e,t,n){if(!e)return;if(!0===n(e))return e;let r=t?e.return:e.child;for(;r;){let e=a(r,t,n);if(e)return e;r=t?null:r.sibling}}function s(e){try{return Object.defineProperties(e,{_currentRenderer:{get:()=>null,set(){}},_currentRenderer2:{get:()=>null,set(){}}})}catch(t){return e}}"u">typeof window&&((null==(r=window.document)?void 0:r.createElement)||(null==(i=window.navigator)?void 0:i.product)==="ReactNative")?o.useLayoutEffect:o.useEffect;let l=s(o.createContext(null));class u extends o.Component{render(){return o.createElement(l.Provider,{value:this._reactInternals},this.props.children)}}function c(){let e=o.useContext(l);if(null===e)throw Error("its-fine: useFiber must be called within a <FiberProvider />!");let t=o.useId();return o.useMemo(()=>{for(let n of[e,null==e?void 0:e.alternate]){if(!n)continue;let e=a(n,!1,e=>{let n=e.memoizedState;for(;n;){if(n.memoizedState===t)return!0;n=n.next}});if(e)return e}},[e,t])}let f=Symbol.for("react.context"),d=e=>null!==e&&"object"==typeof e&&"$$typeof"in e&&e.$$typeof===f;function p(){let e=function(){let e=c(),[t]=o.useState(()=>new Map);t.clear();let n=e;for(;n;){let e=n.type;d(e)&&e!==l&&!t.has(e)&&t.set(e,o.use(s(e))),n=n.return}return t}();return o.useMemo(()=>Array.from(e.keys()).reduce((t,n)=>r=>o.createElement(t,null,o.createElement(n.Provider,{...r,value:e.get(n)})),e=>o.createElement(u,{...e})),[e])}},4538:(e,t,n)=>{n.d(t,{A:()=>r});let r=(0,n(425).A)("map-pin",[["path",{d:"M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0",key:"1r0f0z"}],["circle",{cx:"12",cy:"10",r:"3",key:"ilqhr7"}]])},4577:(e,t,n)=>{e.exports=n(9617)},4643:(e,t,n)=>{n.d(t,{A:()=>r});let r=(0,n(425).A)("volume-2",[["path",{d:"M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z",key:"uqj9uw"}],["path",{d:"M16 9a5 5 0 0 1 0 6",key:"1q6k2b"}],["path",{d:"M19.364 18.364a9 9 0 0 0 0-12.728",key:"ijwkga"}]])},5538:(e,t,n)=>{var r=n(2115),i="function"==typeof Object.is?Object.is:function(e,t){return e===t&&(0!==e||1/e==1/t)||e!=e&&t!=t},o=r.useState,a=r.useEffect,s=r.useLayoutEffect,l=r.useDebugValue;function u(e){var t=e.getSnapshot;e=e.value;try{var n=t();return!i(e,n)}catch(e){return!0}}var c="u"<typeof window||void 0===window.document||void 0===window.document.createElement?function(e,t){return t()}:function(e,t){var n=t(),r=o({inst:{value:n,getSnapshot:t}}),i=r[0].inst,c=r[1];return s(function(){i.value=n,i.getSnapshot=t,u(i)&&c({inst:i})},[e,n,t]),a(function(){return u(i)&&c({inst:i}),e(function(){u(i)&&c({inst:i})})},[e]),l(n),n};t.useSyncExternalStore=void 0!==r.useSyncExternalStore?r.useSyncExternalStore:c},5672:(e,t,n)=>{n.d(t,{A:()=>r});function r(){return(r=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var n=arguments[t];for(var r in n)({}).hasOwnProperty.call(n,r)&&(e[r]=n[r])}return e}).apply(null,arguments)}},5777:(e,t,n)=>{n.d(t,{A:()=>r});let r=(0,n(425).A)("lock",[["rect",{width:"18",height:"11",x:"3",y:"11",rx:"2",ry:"2",key:"1w4ew1"}],["path",{d:"M7 11V7a5 5 0 0 1 10 0v4",key:"fwvmzm"}]])},5867:(e,t,n)=>{n.d(t,{y:()=>i});let r=e=>{let t,n=new Set,r=(e,r)=>{let i="function"==typeof e?e(t):e;if(!Object.is(i,t)){let e=t;t=(null!=r?r:"object"!=typeof i||null===i)?i:Object.assign({},t,i),n.forEach(n=>n(t,e))}},i=()=>t,o={setState:r,getState:i,getInitialState:()=>a,subscribe:e=>(n.add(e),()=>n.delete(e))},a=t=e(r,i,o);return o},i=e=>e?r(e):r},6088:(e,t,n)=>{n.d(t,{A:()=>r});let r=(0,n(425).A)("chevron-down",[["path",{d:"m6 9 6 6 6-6",key:"qrunsl"}]])},6204:(e,t,n)=>{n.d(t,{A:()=>r});let r=(0,n(425).A)("send",[["path",{d:"M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z",key:"1ffxy3"}],["path",{d:"m21.854 2.147-10.94 10.939",key:"12cjpa"}]])},6275:(e,t,n)=>{n.d(t,{Hl:()=>f});var r=n(9590),i=n(2115),o=n(9625);function a(e,t){let n;return(...r)=>{window.clearTimeout(n),n=window.setTimeout(()=>e(...r),t)}}let s=["x","y","top","bottom","left","right","width","height"];var l=n(4400),u=n(5155);function c({ref:e,children:t,fallback:n,resize:l,style:f,gl:d,events:p=r.f,eventSource:m,eventPrefix:h,shadows:v,linear:y,flat:w,legacy:g,orthographic:x,frameloop:b,dpr:S,performance:_,raycaster:A,camera:M,scene:E,onPointerMissed:P,onCreated:z,...L}){i.useMemo(()=>(0,r.e)(o),[]);let C=(0,r.u)(),[k,O]=function({debounce:e,scroll:t,polyfill:n,offsetSize:r}={debounce:0,scroll:!1,offsetSize:!1}){var o,l,u;let c=n||("u"<typeof window?class{}:window.ResizeObserver);if(!c)throw Error("This browser does not support ResizeObserver out of the box. See: https://github.com/react-spring/react-use-measure/#resize-observer-polyfills");let[f,d]=(0,i.useState)({left:0,top:0,width:0,height:0,bottom:0,right:0,x:0,y:0}),p=(0,i.useRef)({element:null,scrollContainers:null,resizeObserver:null,lastBounds:f,orientationHandler:null}),m=e?"number"==typeof e?e:e.scroll:null,h=e?"number"==typeof e?e:e.resize:null,v=(0,i.useRef)(!1);(0,i.useEffect)(()=>(v.current=!0,()=>void(v.current=!1)));let[y,w,g]=(0,i.useMemo)(()=>{let e=()=>{let e,t;if(!p.current.element)return;let{left:n,top:i,width:o,height:a,bottom:l,right:u,x:c,y:f}=p.current.element.getBoundingClientRect(),m={left:n,top:i,width:o,height:a,bottom:l,right:u,x:c,y:f};p.current.element instanceof HTMLElement&&r&&(m.height=p.current.element.offsetHeight,m.width=p.current.element.offsetWidth),Object.freeze(m),v.current&&(e=p.current.lastBounds,t=m,!s.every(n=>e[n]===t[n]))&&d(p.current.lastBounds=m)};return[e,h?a(e,h):e,m?a(e,m):e]},[d,r,m,h]);function x(){p.current.scrollContainers&&(p.current.scrollContainers.forEach(e=>e.removeEventListener("scroll",g,!0)),p.current.scrollContainers=null),p.current.resizeObserver&&(p.current.resizeObserver.disconnect(),p.current.resizeObserver=null),p.current.orientationHandler&&("orientation"in screen&&"removeEventListener"in screen.orientation?screen.orientation.removeEventListener("change",p.current.orientationHandler):"onorientationchange"in window&&window.removeEventListener("orientationchange",p.current.orientationHandler))}function b(){p.current.element&&(p.current.resizeObserver=new c(g),p.current.resizeObserver.observe(p.current.element),t&&p.current.scrollContainers&&p.current.scrollContainers.forEach(e=>e.addEventListener("scroll",g,{capture:!0,passive:!0})),p.current.orientationHandler=()=>{g()},"orientation"in screen&&"addEventListener"in screen.orientation?screen.orientation.addEventListener("change",p.current.orientationHandler):"onorientationchange"in window&&window.addEventListener("orientationchange",p.current.orientationHandler))}return o=g,l=!!t,(0,i.useEffect)(()=>{if(l)return window.addEventListener("scroll",o,{capture:!0,passive:!0}),()=>void window.removeEventListener("scroll",o,!0)},[o,l]),u=w,(0,i.useEffect)(()=>(window.addEventListener("resize",u),()=>void window.removeEventListener("resize",u)),[u]),(0,i.useEffect)(()=>{x(),b()},[t,g,w]),(0,i.useEffect)(()=>x,[]),[e=>{e&&e!==p.current.element&&(x(),p.current.element=e,p.current.scrollContainers=function e(t){let n=[];if(!t||t===document.body)return n;let{overflow:r,overflowX:i,overflowY:o}=window.getComputedStyle(t);return[r,i,o].some(e=>"auto"===e||"scroll"===e)&&n.push(t),[...n,...e(t.parentElement)]}(e),b())},f,y]}({scroll:!0,debounce:{scroll:50,resize:0},...l}),R=i.useRef(null),j=i.useRef(null);i.useImperativeHandle(e,()=>R.current);let I=(0,r.a)(P),[T,U]=i.useState(!1),[q,D]=i.useState(!1);if(T)throw T;if(q)throw q;let H=i.useRef(null);(0,r.b)(()=>{let e=R.current;O.width>0&&O.height>0&&e&&(H.current||(H.current=(0,r.c)(e)),async function(){await H.current.configure({gl:d,scene:E,events:p,shadows:v,linear:y,flat:w,legacy:g,orthographic:x,frameloop:b,dpr:S,performance:_,raycaster:A,camera:M,size:O,onPointerMissed:(...e)=>null==I.current?void 0:I.current(...e),onCreated:e=>{null==e.events.connect||e.events.connect(m?(0,r.i)(m)?m.current:m:j.current),h&&e.setEvents({compute:(e,t)=>{let n=e[h+"X"],r=e[h+"Y"];t.pointer.set(n/t.size.width*2-1,-(2*(r/t.size.height))+1),t.raycaster.setFromCamera(t.pointer,t.camera)}}),null==z||z(e)}}),H.current.render((0,u.jsx)(C,{children:(0,u.jsx)(r.E,{set:D,children:(0,u.jsx)(i.Suspense,{fallback:(0,u.jsx)(r.B,{set:U}),children:null!=t?t:null})})}))}())}),i.useEffect(()=>{let e=R.current;if(e)return()=>(0,r.d)(e)},[]);let B=m?"none":"auto";return(0,u.jsx)("div",{ref:j,style:{position:"relative",width:"100%",height:"100%",overflow:"hidden",pointerEvents:B,...f},...L,children:(0,u.jsx)("div",{ref:k,style:{width:"100%",height:"100%"},children:(0,u.jsx)("canvas",{ref:R,style:{display:"block"},children:n})})})}function f(e){return(0,u.jsx)(l.Af,{children:(0,u.jsx)(c,{...e})})}n(8745)},6351:(e,t,n)=>{n.d(t,{OY:()=>e_,g6:()=>ex,Ll:()=>eg});var r,i,o,a,s,l,u,c,f,d,p,m,h,v,y,w,g,x,b,S,_,A,M,E,P,z=n(5672),L=n(2115),C=n(2669),k=n(9590);function O(e,t,n){return t in e?Object.defineProperty(e,t,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[t]=n,e}var R=n(5269);function j(e,t){(null==t||t>e.length)&&(t=e.length);for(var n=0,r=Array(t);n<t;n++)r[n]=e[n];return r}function I(e,t){if(e){if("string"==typeof e)return j(e,t);var n=Object.prototype.toString.call(e).slice(8,-1);if("Object"===n&&e.constructor&&(n=e.constructor.name),"Map"===n||"Set"===n)return Array.from(e);if("Arguments"===n||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(n))return j(e,t)}}function T(e){return function(e){if(Array.isArray(e))return j(e)}(e)||function(e){if("u">typeof Symbol&&null!=e[Symbol.iterator]||null!=e["@@iterator"])return Array.from(e)}(e)||I(e)||function(){throw TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")}()}new R.I9Y,new R.I9Y;function U(e,t){if(!(e instanceof t))throw TypeError("Cannot call a class as a function")}var q=function e(t,n,r){var i=this;U(this,e),O(this,"dot2",function(e,t){return i.x*e+i.y*t}),O(this,"dot3",function(e,t,n){return i.x*e+i.y*t+i.z*n}),this.x=t,this.y=n,this.z=r},D=[new q(1,1,0),new q(-1,1,0),new q(1,-1,0),new q(-1,-1,0),new q(1,0,1),new q(-1,0,1),new q(1,0,-1),new q(-1,0,-1),new q(0,1,1),new q(0,-1,1),new q(0,1,-1),new q(0,-1,-1)],H=[151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180],B=Array(512),W=Array(512),F=0;(F=Math.floor(F))<256&&(F|=F<<8);for(var N,$=0;$<256;$++)N=1&$?H[$]^255&F:H[$]^F>>8&255,B[$]=B[$+256]=N,W[$]=W[$+256]=D[N%12];function V(e){var t=function(e){if("number"==typeof e)e=Math.abs(e);else if("string"==typeof e){var t=e;e=0;for(var n=0;n<t.length;n++)e=(e+(n+1)*(t.charCodeAt(n)%96))%0x7fffffff}return 0===e&&(e=311),e}(e);return function(){var e=48271*t%0x7fffffff;return t=e,e/0x7fffffff}}new function e(t){var n=this;U(this,e),O(this,"seed",0),O(this,"init",function(e){n.seed=e,n.value=V(e)}),O(this,"value",V(this.seed)),this.init(t)}(Math.random());var Y=function(e){return 1/(1+e+.48*e*e+.235*e*e*e)};function G(e,t,n){var r=arguments.length>3&&void 0!==arguments[3]?arguments[3]:.25,i=arguments.length>4&&void 0!==arguments[4]?arguments[4]:.01,o=arguments.length>5&&void 0!==arguments[5]?arguments[5]:1/0,a=arguments.length>6&&void 0!==arguments[6]?arguments[6]:Y,s=arguments.length>7&&void 0!==arguments[7]?arguments[7]:.001,l="velocity_"+t;if(void 0===e.__damp&&(e.__damp={}),void 0===e.__damp[l]&&(e.__damp[l]=0),Math.abs(e[t]-n)<=s)return e[t]=n,!1;var u=2/(r=Math.max(1e-4,r)),c=a(u*i),f=e[t]-n,d=n,p=o*r;f=Math.min(Math.max(f,-p),p),n=e[t]-f;var m=(e.__damp[l]+u*f)*i;e.__damp[l]=(e.__damp[l]-u*m)*c;var h=n+(f+m)*c;return d-e[t]>0==h>d&&(h=d,e.__damp[l]=(h-d)/i),e[t]=h,!0}var Q=new R.Pq0,X=new R.PTz,Z=new R.PTz,J=new R.kn4,K=new R.Pq0;function ee(e,t,n,r,i,o,a,s){var l,u,c,f;return G(e,t,e[t]+(c=(l=n-e[t])-Math.floor(l/(u=2*Math.PI))*u,(f=Math.max(0,Math.min(u,c)))>Math.PI&&(f-=2*Math.PI),f),r,i,o,a,s)}var et=new R.I9Y,en=new R.Pq0;function er(e,t,n,r,i,l,u){return"number"==typeof t?en.setScalar(t):Array.isArray(t)?en.set(t[0],t[1],t[2]):en.copy(t),o=G(e,"x",en.x,n,r,i,l,u),a=G(e,"y",en.y,n,r,i,l,u),s=G(e,"z",en.z,n,r,i,l,u),o||a||s}var ei=new R.IUQ,eo=new R.O9p,ea=new R.Q1f,es=new R.PTz,el=new R.IUQ,eu=new R.IUQ,ec=new R.IUQ;function ef(e,t,n,r,i,o,a){Array.isArray(t)?es.set(t[0],t[1],t[2],t[3]):es.copy(t);var s=e.dot(es)>0?1:-1;return es.x*=s,es.y*=s,es.z*=s,es.w*=s,w=G(e,"x",es.x,n,r,i,o,a),g=G(e,"y",es.y,n,r,i,o,a),x=G(e,"z",es.z,n,r,i,o,a),b=G(e,"w",es.w,n,r,i,o,a),el.set(e.x,e.y,e.z,e.w).normalize(),eu.set(e.__damp.velocity_x,e.__damp.velocity_y,e.__damp.velocity_z,e.__damp.velocity_w),ec.copy(el).multiplyScalar(eu.dot(el)/el.dot(el)),e.__damp.velocity_x-=ec.x,e.__damp.velocity_y-=ec.y,e.__damp.velocity_z-=ec.z,e.__damp.velocity_w-=ec.w,e.set(el.x,el.y,el.z,el.w),w||g||x||b}var ed=new R.YHV,ep=new R.kn4,em=new R.Pq0,eh=new R.PTz,ev=new R.Pq0,ey=Object.freeze({__proto__:null,rsqw:function(e){var t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:.01,n=arguments.length>2&&void 0!==arguments[2]?arguments[2]:1,r=arguments.length>3&&void 0!==arguments[3]?arguments[3]:1/(2*Math.PI);return n/Math.atan(1/t)*Math.atan(Math.sin(2*Math.PI*e*r)/t)},exp:Y,linear:function(e){return e},sine:{in:function(e){return 1-Math.cos(e*Math.PI/2)},out:function(e){return Math.sin(e*Math.PI/2)},inOut:function(e){return-(Math.cos(Math.PI*e)-1)/2}},cubic:{in:function(e){return e*e*e},out:function(e){return 1-Math.pow(1-e,3)},inOut:function(e){return e<.5?4*e*e*e:1-Math.pow(-2*e+2,3)/2}},quint:{in:function(e){return e*e*e*e*e},out:function(e){return 1-Math.pow(1-e,5)},inOut:function(e){return e<.5?16*e*e*e*e*e:1-Math.pow(-2*e+2,5)/2}},circ:{in:function(e){return 1-Math.sqrt(1-Math.pow(e,2))},out:function(e){return Math.sqrt(1-Math.pow(e-1,2))},inOut:function(e){return e<.5?(1-Math.sqrt(1-Math.pow(2*e,2)))/2:(Math.sqrt(1-Math.pow(-2*e+2,2))+1)/2}},quart:{in:function(e){return e*e*e*e},out:function(e){return 1- --e*e*e*e},inOut:function(e){return e<.5?8*e*e*e*e:1-8*--e*e*e*e}},expo:{in:function(e){return 0===e?0:Math.pow(2,10*e-10)},out:function(e){return 1===e?1:1-Math.pow(2,-10*e)},inOut:function(e){return 0===e?0:1===e?1:e<.5?Math.pow(2,20*e-10)/2:(2-Math.pow(2,-20*e+10))/2}},damp:G,dampLookAt:function(e,t,n,r,i,o,a){"number"==typeof t?Q.setScalar(t):Array.isArray(t)?Q.set(t[0],t[1],t[2]):Q.copy(t);var s=e.parent;(e.updateWorldMatrix(!0,!1),K.setFromMatrixPosition(e.matrixWorld),e&&e.isCamera||e&&e.isLight)?J.lookAt(K,Q,e.up):J.lookAt(Q,K,e.up),ef(e.quaternion,Z.setFromRotationMatrix(J),n,r,i,o,a),s&&(J.extractRotation(s.matrixWorld),X.setFromRotationMatrix(J),ef(e.quaternion,Z.copy(e.quaternion).premultiply(X.invert()),n,r,i,o,a))},dampAngle:ee,damp2:function(e,t,n,o,a,s,l){return"number"==typeof t?et.setScalar(t):Array.isArray(t)?et.set(t[0],t[1]):et.copy(t),r=G(e,"x",et.x,n,o,a,s,l),i=G(e,"y",et.y,n,o,a,s,l),r||i},damp3:er,damp4:function(e,t,n,r,i,o,a){return"number"==typeof t?ei.setScalar(t):Array.isArray(t)?ei.set(t[0],t[1],t[2],t[3]):ei.copy(t),l=G(e,"x",ei.x,n,r,i,o,a),u=G(e,"y",ei.y,n,r,i,o,a),c=G(e,"z",ei.z,n,r,i,o,a),f=G(e,"w",ei.w,n,r,i,o,a),l||u||c||f},dampE:function(e,t,n,r,i,o,a){return Array.isArray(t)?eo.set(t[0],t[1],t[2],t[3]):eo.copy(t),d=ee(e,"x",eo.x,n,r,i,o,a),p=ee(e,"y",eo.y,n,r,i,o,a),m=ee(e,"z",eo.z,n,r,i,o,a),d||p||m},dampC:function(e,t,n,r,i,o,a){return t instanceof R.Q1f?ea.copy(t):Array.isArray(t)?ea.setRGB(t[0],t[1],t[2]):ea.set(t),h=G(e,"r",ea.r,n,r,i,o,a),v=G(e,"g",ea.g,n,r,i,o,a),y=G(e,"b",ea.b,n,r,i,o,a),h||v||y},dampQ:ef,dampS:function(e,t,n,r,i,o,a){return Array.isArray(t)?ed.set(t[0],t[1],t[2]):ed.copy(t),S=G(e,"radius",ed.radius,n,r,i,o,a),_=ee(e,"phi",ed.phi,n,r,i,o,a),A=ee(e,"theta",ed.theta,n,r,i,o,a),S||_||A},dampM:function(e,t,n,r,i,o,a){return void 0===e.__damp&&(e.__damp={position:new R.Pq0,rotation:new R.PTz,scale:new R.Pq0},e.decompose(e.__damp.position,e.__damp.rotation,e.__damp.scale)),Array.isArray(t)?ep.set.apply(ep,T(t)):ep.copy(t),ep.decompose(em,eh,ev),M=er(e.__damp.position,em,n,r,i,o,a),E=ef(e.__damp.rotation,eh,n,r,i,o,a),P=er(e.__damp.scale,ev,n,r,i,o,a),e.compose(e.__damp.position,e.__damp.rotation,e.__damp.scale),M||E||P}});R.LoY;let ew=L.createContext(null);function eg(){return L.useContext(ew)}function ex({eps:e=1e-5,enabled:t=!0,infinite:n,horizontal:r,pages:i=1,distance:o=1,damping:a=.25,maxSpeed:s=1/0,prepend:l=!1,style:u={},children:c}){let{get:f,setEvents:d,gl:p,size:m,invalidate:h,events:v}=(0,k.C)(),[y]=L.useState(()=>document.createElement("div")),[w]=L.useState(()=>document.createElement("div")),[g]=L.useState(()=>document.createElement("div")),x=p.domElement.parentNode,b=L.useRef(0),S=L.useMemo(()=>({el:y,eps:e,fill:w,fixed:g,horizontal:r,damping:a,offset:0,delta:0,scroll:b,pages:i,range(e,t,n=0){let r=e-n,i=r+t+2*n;return this.offset<r?0:this.offset>i?1:(this.offset-r)/(i-r)},curve(e,t,n=0){return Math.sin(this.range(e,t,n)*Math.PI)},visible(e,t,n=0){let r=e-n;return this.offset>=r&&this.offset<=r+t+2*n}}),[e,a,r,i]);L.useEffect(()=>{for(let e in y.style.position="absolute",y.style.width="100%",y.style.height="100%",y.style[r?"overflowX":"overflowY"]="auto",y.style[r?"overflowY":"overflowX"]="hidden",y.style.top="0px",y.style.left="0px",u)y.style[e]=u[e];g.style.position="sticky",g.style.top="0px",g.style.left="0px",g.style.width="100%",g.style.height="100%",g.style.overflow="hidden",y.appendChild(g),w.style.height=r?"100%":`${i*o*100}%`,w.style.width=r?`${i*o*100}%`:"100%",w.style.pointerEvents="none",y.appendChild(w),l?x.prepend(y):x.appendChild(y),y[r?"scrollLeft":"scrollTop"]=1;let e=v.connected||p.domElement;requestAnimationFrame(()=>null==v.connect?void 0:v.connect(y));let t=f().events.compute;return d({compute(e,t){let{left:n,top:r}=x.getBoundingClientRect(),i=e.clientX-n,o=e.clientY-r;t.pointer.set(i/t.size.width*2-1,-(2*(o/t.size.height))+1),t.raycaster.setFromCamera(t.pointer,t.camera)}}),()=>{x.removeChild(y),d({compute:t}),null==v.connect||v.connect(e)}},[i,o,r,y,w,g,x]),L.useEffect(()=>{if(v.connected===y){let e=m[r?"width":"height"],i=y[r?"scrollWidth":"scrollHeight"],o=i-e,a=0,s=!0,l=!0,u=()=>{if(t&&!l&&(h(),b.current=(a=y[r?"scrollLeft":"scrollTop"])/o,n)){if(!s){if(a>=o){let e=1-S.offset;y[r?"scrollLeft":"scrollTop"]=1,b.current=S.offset=-e,s=!0}else if(a<=0){let e=1+S.offset;y[r?"scrollLeft":"scrollTop"]=i,b.current=S.offset=e,s=!0}}s&&setTimeout(()=>s=!1,40)}};y.addEventListener("scroll",u,{passive:!0}),requestAnimationFrame(()=>l=!1);let c=e=>y.scrollLeft+=e.deltaY/2;return r&&y.addEventListener("wheel",c,{passive:!0}),()=>{y.removeEventListener("scroll",u),r&&y.removeEventListener("wheel",c)}}},[y,v,m,n,S,h,r,t]);let _=0;return(0,k.D)((t,n)=>{_=S.offset,ey.damp(S,"offset",b.current,a,n,s,void 0,e),ey.damp(S,"delta",Math.abs(_-S.offset),a,n,s,void 0,e),S.delta>e&&h()}),L.createElement(ew.Provider,{value:S},c)}let eb=L.forwardRef(({children:e},t)=>{let n=L.useRef(null);L.useImperativeHandle(t,()=>n.current,[]);let r=eg(),{width:i,height:o}=(0,k.C)(e=>e.viewport);return(0,k.D)(()=>{n.current.position.x=r.horizontal?-i*(r.pages-1)*r.offset:0,n.current.position.y=r.horizontal?0:o*(r.pages-1)*r.offset}),L.createElement("group",{ref:n},e)}),eS=L.forwardRef(({children:e,style:t,...n},r)=>{let i=eg(),o=L.useRef(null);L.useImperativeHandle(r,()=>o.current,[]);let{width:a,height:s}=(0,k.C)(e=>e.size),l=L.useContext(k.q),u=L.useMemo(()=>C.createRoot(i.fixed),[i.fixed]);return(0,k.D)(()=>{i.delta>i.eps&&(o.current.style.transform=`translate3d(${i.horizontal?-a*(i.pages-1)*i.offset:0}px,${i.horizontal?0:-(s*(i.pages-1)*i.offset)}px,0)`)}),u.render(L.createElement("div",(0,z.A)({ref:o,style:{...t,position:"absolute",top:0,left:0,willChange:"transform"}},n),L.createElement(ew.Provider,{value:i},L.createElement(k.q.Provider,{value:l},e)))),null}),e_=L.forwardRef(({html:e,...t},n)=>L.createElement(e?eS:eb,(0,z.A)({ref:n},t)))},7233:(e,t,n)=>{n.d(t,{A:()=>r});let r=(0,n(425).A)("github",[["path",{d:"M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4",key:"tonef"}],["path",{d:"M9 18c-4.51 2-5-2-7-2",key:"9comsn"}]])},7385:(e,t,n)=>{let r;n.d(t,{mK:()=>E,s0:()=>S,fE:()=>z});var i=n(5155),o=n(2115),a=n(5269),s=n(9590),l=n(6926);function u(e,t,n){return t in e?Object.defineProperty(e,t,{value:n,enumerable:!0,configurable:!0,writable:!0}):e[t]=n,e}new a.I9Y,new a.I9Y;function c(e,t){if(!(e instanceof t))throw TypeError("Cannot call a class as a function")}var f=function e(t,n,r){var i=this;c(this,e),u(this,"dot2",function(e,t){return i.x*e+i.y*t}),u(this,"dot3",function(e,t,n){return i.x*e+i.y*t+i.z*n}),this.x=t,this.y=n,this.z=r},d=[new f(1,1,0),new f(-1,1,0),new f(1,-1,0),new f(-1,-1,0),new f(1,0,1),new f(-1,0,1),new f(1,0,-1),new f(-1,0,-1),new f(0,1,1),new f(0,-1,1),new f(0,1,-1),new f(0,-1,-1)],p=[151,160,137,91,90,15,131,13,201,95,96,53,194,233,7,225,140,36,103,30,69,142,8,99,37,240,21,10,23,190,6,148,247,120,234,75,0,26,197,62,94,252,219,203,117,35,11,32,57,177,33,88,237,149,56,87,174,20,125,136,171,168,68,175,74,165,71,134,139,48,27,166,77,146,158,231,83,111,229,122,60,211,133,230,220,105,92,41,55,46,245,40,244,102,143,54,65,25,63,161,1,216,80,73,209,76,132,187,208,89,18,169,200,196,135,130,116,188,159,86,164,100,109,198,173,186,3,64,52,217,226,250,124,123,5,202,38,147,118,126,255,82,85,212,207,206,59,227,47,16,58,17,182,189,28,42,223,183,170,213,119,248,152,2,44,154,163,70,221,153,101,155,167,43,172,9,129,22,39,253,19,98,108,110,79,113,224,232,178,185,112,104,218,246,97,228,251,34,242,193,238,210,144,12,191,179,162,241,81,51,145,235,249,14,239,107,49,192,214,31,181,199,106,157,184,84,204,176,115,121,50,45,127,4,150,254,138,236,205,93,222,114,67,29,24,72,243,141,128,195,78,66,215,61,156,180],m=Array(512),h=Array(512),v=0;(v=Math.floor(v))<256&&(v|=v<<8);for(var y,w=0;w<256;w++)y=1&w?p[w]^255&v:p[w]^v>>8&255,m[w]=m[w+256]=y,h[w]=h[w+256]=d[y%12];function g(e){var t=function(e){if("number"==typeof e)e=Math.abs(e);else if("string"==typeof e){var t=e;e=0;for(var n=0;n<t.length;n++)e=(e+(n+1)*(t.charCodeAt(n)%96))%0x7fffffff}return 0===e&&(e=311),e}(e);return function(){var e=48271*t%0x7fffffff;return t=e,e/0x7fffffff}}new function e(t){var n=this;c(this,e),u(this,"seed",0),u(this,"init",function(e){n.seed=e,n.value=g(e)}),u(this,"value",g(this.seed)),this.init(t)}(Math.random());a.LoY;n(521);let x=(0,o.createContext)(null),b=e=>(2&e.getAttributes())==2,S=(0,o.memo)((0,o.forwardRef)(({children:e,camera:t,scene:n,resolutionScale:r,enabled:u=!0,renderPriority:c=1,autoClear:f=!0,depthBuffer:d,enableNormalPass:p,stencilBuffer:m,multisampling:h=8,frameBufferType:v=a.ix0},y)=>{let{gl:w,scene:g,camera:S,size:_}=(0,s.C)(),A=n||g,M=t||S,[E,P,z]=(0,o.useMemo)(()=>{let e=new l.s0(w,{depthBuffer:d,stencilBuffer:m,multisampling:h,frameBufferType:v});e.addPass(new l.AH(A,M));let t=null,n=null;return p&&((n=new l.Xe(A,M)).enabled=!1,e.addPass(n),void 0!==r&&((t=new l.SP({normalBuffer:n.texture,resolutionScale:r})).enabled=!1,e.addPass(t))),[e,n,t]},[M,w,d,m,h,v,A,p,r]);(0,o.useEffect)(()=>E?.setSize(_.width,_.height),[E,_]),(0,s.D)((e,t)=>{if(u){let e=w.autoClear;w.autoClear=f,m&&!f&&w.clearStencil(),E.render(t),w.autoClear=e}},u?c:0);let L=(0,o.useRef)(null);(0,o.useLayoutEffect)(()=>{let e=[],t=L.current.__r3f;if(t&&E){let n=t.children;for(let t=0;t<n.length;t++){let r=n[t].object;if(r instanceof l.Mj){let i=[r];if(!b(r)){let e=null;for(;(e=n[t+1]?.object)instanceof l.Mj&&!b(e);)i.push(e),t++}let o=new l.Vu(M,...i);e.push(o)}else r instanceof l.oF&&e.push(r)}for(let t of e)E?.addPass(t);P&&(P.enabled=!0),z&&(z.enabled=!0)}return()=>{for(let t of e)E?.removePass(t);P&&(P.enabled=!1),z&&(z.enabled=!1)}},[E,e,M,P,z]),(0,o.useEffect)(()=>{let e=w.toneMapping;return w.toneMapping=a.y_p,()=>{w.toneMapping=e}},[w]);let C=(0,o.useMemo)(()=>({composer:E,normalPass:P,downSamplingPass:z,resolutionScale:r,camera:M,scene:A}),[E,P,z,r,M,A]);return(0,o.useImperativeHandle)(y,()=>E,[E]),(0,i.jsx)(x.Provider,{value:C,children:(0,i.jsx)("group",{ref:L,children:e})})})),_=0,A=new WeakMap,M=(e,t)=>function({blendFunction:n=t?.blendFunction,opacity:r=t?.opacity,...a}){let l=A.get(e);if(!l){let t=`@react-three/postprocessing/${e.name}-${_++}`;(0,s.e)({[t]:e}),A.set(e,l=t)}let u=(0,s.C)(e=>e.camera),c=o.useMemo(()=>[...t?.args??[],...a.args??[{...t,...a}]],[JSON.stringify(a)]);return(0,i.jsx)(l,{camera:u,"blendMode-blendFunction":n,"blendMode-opacity-value":r,...a,args:c})};l.Mj;let E=M(l.bv,{blendFunction:0});l.i,l.hH;var P=((r=P||{})[r.Linear=0]="Linear",r[r.Radial=1]="Radial",r[r.MirroredLinear=2]="MirroredLinear",r);l.Mj;let z=M(l.K1),L=(l.To,{fragmentShader:`

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
    `});l.Mj;l.Mj;l.Mj},7815:(e,t,n)=>{n.d(t,{n:()=>a});var r=n(2115),i=n(9590),o=n(5269);let a=r.forwardRef(({children:e,enabled:t=!0,speed:n=1,rotationIntensity:a=1,floatIntensity:s=1,floatingRange:l=[-.1,.1],autoInvalidate:u=!1,...c},f)=>{let d=r.useRef(null);r.useImperativeHandle(f,()=>d.current,[]);let p=r.useRef(1e4*Math.random());return(0,i.D)(e=>{var r,i;if(!t||0===n)return;u&&e.invalidate();let c=p.current+e.clock.elapsedTime;d.current.rotation.x=Math.cos(c/4*n)/8*a,d.current.rotation.y=Math.sin(c/4*n)/8*a,d.current.rotation.z=Math.sin(c/4*n)/20*a;let f=Math.sin(c/4*n)/10;f=o.cj9.mapLinear(f,-.1,.1,null!=(r=null==l?void 0:l[0])?r:-.1,null!=(i=null==l?void 0:l[1])?i:.1),d.current.position.y=f*s,d.current.updateMatrix()}),r.createElement("group",c,r.createElement("group",{ref:d,matrixAutoUpdate:!1},e))})},7930:(e,t)=>{function n(e,t){var n=e.length;for(e.push(t);0<n;){var r=n-1>>>1,i=e[r];if(0<o(i,t))e[r]=t,e[n]=i,n=r;else break}}function r(e){return 0===e.length?null:e[0]}function i(e){if(0===e.length)return null;var t=e[0],n=e.pop();if(n!==t){e[0]=n;for(var r=0,i=e.length,a=i>>>1;r<a;){var s=2*(r+1)-1,l=e[s],u=s+1,c=e[u];if(0>o(l,n))u<i&&0>o(c,l)?(e[r]=c,e[u]=n,r=u):(e[r]=l,e[s]=n,r=s);else if(u<i&&0>o(c,n))e[r]=c,e[u]=n,r=u;else break}}return t}function o(e,t){var n=e.sortIndex-t.sortIndex;return 0!==n?n:e.id-t.id}if(t.unstable_now=void 0,"object"==typeof performance&&"function"==typeof performance.now){var a,s=performance;t.unstable_now=function(){return s.now()}}else{var l=Date,u=l.now();t.unstable_now=function(){return l.now()-u}}var c=[],f=[],d=1,p=null,m=3,h=!1,v=!1,y=!1,w=!1,g="function"==typeof setTimeout?setTimeout:null,x="function"==typeof clearTimeout?clearTimeout:null,b="u">typeof setImmediate?setImmediate:null;function S(e){for(var t=r(f);null!==t;){if(null===t.callback)i(f);else if(t.startTime<=e)i(f),t.sortIndex=t.expirationTime,n(c,t);else break;t=r(f)}}function _(e){if(y=!1,S(e),!v)if(null!==r(c))v=!0,A||(A=!0,a());else{var t=r(f);null!==t&&O(_,t.startTime-e)}}var A=!1,M=-1,E=5,P=-1;function z(){return!!w||!(t.unstable_now()-P<E)}function L(){if(w=!1,A){var e=t.unstable_now();P=e;var n=!0;try{e:{v=!1,y&&(y=!1,x(M),M=-1),h=!0;var o=m;try{t:{for(S(e),p=r(c);null!==p&&!(p.expirationTime>e&&z());){var s=p.callback;if("function"==typeof s){p.callback=null,m=p.priorityLevel;var l=s(p.expirationTime<=e);if(e=t.unstable_now(),"function"==typeof l){p.callback=l,S(e),n=!0;break t}p===r(c)&&i(c),S(e)}else i(c);p=r(c)}if(null!==p)n=!0;else{var u=r(f);null!==u&&O(_,u.startTime-e),n=!1}}break e}finally{p=null,m=o,h=!1}}}finally{n?a():A=!1}}}if("function"==typeof b)a=function(){b(L)};else if("u">typeof MessageChannel){var C=new MessageChannel,k=C.port2;C.port1.onmessage=L,a=function(){k.postMessage(null)}}else a=function(){g(L,0)};function O(e,n){M=g(function(){e(t.unstable_now())},n)}t.unstable_IdlePriority=5,t.unstable_ImmediatePriority=1,t.unstable_LowPriority=4,t.unstable_NormalPriority=3,t.unstable_Profiling=null,t.unstable_UserBlockingPriority=2,t.unstable_cancelCallback=function(e){e.callback=null},t.unstable_forceFrameRate=function(e){0>e||125<e?console.error("forceFrameRate takes a positive int between 0 and 125, forcing frame rates higher than 125 fps is not supported"):E=0<e?Math.floor(1e3/e):5},t.unstable_getCurrentPriorityLevel=function(){return m},t.unstable_next=function(e){switch(m){case 1:case 2:case 3:var t=3;break;default:t=m}var n=m;m=t;try{return e()}finally{m=n}},t.unstable_requestPaint=function(){w=!0},t.unstable_runWithPriority=function(e,t){switch(e){case 1:case 2:case 3:case 4:case 5:break;default:e=3}var n=m;m=e;try{return t()}finally{m=n}},t.unstable_scheduleCallback=function(e,i,o){var s=t.unstable_now();switch(o="object"==typeof o&&null!==o&&"number"==typeof(o=o.delay)&&0<o?s+o:s,e){case 1:var l=-1;break;case 2:l=250;break;case 5:l=0x3fffffff;break;case 4:l=1e4;break;default:l=5e3}return l=o+l,e={id:d++,callback:i,priorityLevel:e,startTime:o,expirationTime:l,sortIndex:-1},o>s?(e.sortIndex=o,n(f,e),null===r(c)&&e===r(f)&&(y?(x(M),M=-1):y=!0,O(_,o-s))):(e.sortIndex=l,n(c,e),v||h||(v=!0,A||(A=!0,a()))),e},t.unstable_shouldYield=z,t.unstable_wrapCallback=function(e){var t=m;return function(){var n=m;m=t;try{return e.apply(this,arguments)}finally{m=n}}}},8039:(e,t,n)=>{e.exports=n(5538)},8745:(e,t,n)=>{e.exports=n(7930)},8817:(e,t,n)=>{n.d(t,{A:()=>r});let r=(0,n(425).A)("volume-x",[["path",{d:"M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z",key:"uqj9uw"}],["line",{x1:"22",x2:"16",y1:"9",y2:"15",key:"1ewh16"}],["line",{x1:"16",x2:"22",y1:"9",y2:"15",key:"5ykzw1"}]])},9326:(e,t,n)=>{n.d(t,{DY:()=>a,IU:()=>l,uv:()=>s});let r=[];function i(e,t,n=(e,t)=>e===t){if(e===t)return!0;if(!e||!t)return!1;let r=e.length;if(t.length!==r)return!1;for(let i=0;i<r;i++)if(!n(e[i],t[i]))return!1;return!0}function o(e,t=null,n=!1,a={}){for(let o of(null===t&&(t=[e]),r))if(i(t,o.keys,o.equal)){if(n)return;if(Object.prototype.hasOwnProperty.call(o,"error"))throw o.error;if(Object.prototype.hasOwnProperty.call(o,"response"))return a.lifespan&&a.lifespan>0&&(o.timeout&&clearTimeout(o.timeout),o.timeout=setTimeout(o.remove,a.lifespan)),o.response;if(!n)throw o.promise}let s={keys:t,equal:a.equal,remove:()=>{let e=r.indexOf(s);-1!==e&&r.splice(e,1)},promise:("object"==typeof e&&"function"==typeof e.then?e:e(...t)).then(e=>{s.response=e,a.lifespan&&a.lifespan>0&&(s.timeout=setTimeout(s.remove,a.lifespan))}).catch(e=>s.error=e)};if(r.push(s),!n)throw s.promise}let a=(e,t,n)=>o(e,t,!1,n),s=(e,t,n)=>void o(e,t,!0,n),l=e=>{if(void 0===e||0===e.length)r.splice(0,r.length);else{let t=r.find(t=>i(e,t.keys,t.equal));t&&t.remove()}}},9617:(e,t,n)=>{var r=n(2115),i=n(8039),o="function"==typeof Object.is?Object.is:function(e,t){return e===t&&(0!==e||1/e==1/t)||e!=e&&t!=t},a=i.useSyncExternalStore,s=r.useRef,l=r.useEffect,u=r.useMemo,c=r.useDebugValue;t.useSyncExternalStoreWithSelector=function(e,t,n,r,i){var f=s(null);if(null===f.current){var d={hasValue:!1,value:null};f.current=d}else d=f.current;var p=a(e,(f=u(function(){function e(e){if(!l){if(l=!0,a=e,e=r(e),void 0!==i&&d.hasValue){var t=d.value;if(i(t,e))return s=t}return s=e}if(t=s,o(a,e))return t;var n=r(e);return void 0!==i&&i(t,n)?(a=e,t):(a=e,s=n)}var a,s,l=!1,u=void 0===n?null:n;return[function(){return e(t())},null===u?void 0:function(){return e(u())}]},[t,n,r,i]))[0],f[1]);return l(function(){d.hasValue=!0,d.value=p},[p]),c(p),p}},9667:(e,t,n)=>{let r,i;n.d(t,{E:()=>g});var o=n(5672),a=n(2115),s=n(2669),l=n(5269),u=n(9590);let c=new l.Pq0,f=new l.Pq0,d=new l.Pq0,p=new l.I9Y;function m(e,t,n){let r=c.setFromMatrixPosition(e.matrixWorld);r.project(t);let i=n.width/2,o=n.height/2;return[r.x*i+i,-(r.y*o)+o]}let h=e=>1e-10>Math.abs(e)?0:e;function v(e,t,n=""){let r="matrix3d(";for(let n=0;16!==n;n++)r+=h(t[n]*e.elements[n])+(15!==n?",":")");return n+r}let y=(r=[1,-1,1,1,1,-1,1,1,1,-1,1,1,1,-1,1,1],e=>v(e,r)),w=(i=e=>[1/e,1/e,1/e,1,-1/e,-1/e,-1/e,-1,1/e,1/e,1/e,1,1,1,1,1],(e,t)=>v(e,i(t),"translate(-50%,-50%)")),g=a.forwardRef(({children:e,eps:t=.001,style:n,className:r,prepend:i,center:v,fullscreen:g,portal:x,distanceFactor:b,sprite:S=!1,transform:_=!1,occlude:A,onOcclude:M,castShadow:E,receiveShadow:P,material:z,geometry:L,zIndexRange:C=[0x1000037,0],calculatePosition:k=m,as:O="div",wrapperClass:R,pointerEvents:j="auto",...I},T)=>{let{gl:U,camera:q,scene:D,size:H,raycaster:B,events:W,viewport:F}=(0,u.C)(),[N]=a.useState(()=>document.createElement(O)),$=a.useRef(null),V=a.useRef(null),Y=a.useRef(0),G=a.useRef([0,0]),Q=a.useRef(null),X=a.useRef(null),Z=(null==x?void 0:x.current)||W.connected||U.domElement.parentNode,J=a.useRef(null),K=a.useRef(!1),ee=a.useMemo(()=>{var e;return A&&"blending"!==A||Array.isArray(A)&&A.length&&(e=A[0])&&"object"==typeof e&&"current"in e},[A]);a.useLayoutEffect(()=>{let e=U.domElement;A&&"blending"===A?(e.style.zIndex=`${Math.floor(C[0]/2)}`,e.style.position="absolute",e.style.pointerEvents="none"):(e.style.zIndex=null,e.style.position=null,e.style.pointerEvents=null)},[A]),a.useLayoutEffect(()=>{if(V.current){let e=$.current=s.createRoot(N);if(D.updateMatrixWorld(),_)N.style.cssText="position:absolute;top:0;left:0;pointer-events:none;overflow:hidden;";else{let e=k(V.current,q,H);N.style.cssText=`position:absolute;top:0;left:0;transform:translate3d(${e[0]}px,${e[1]}px,0);transform-origin:0 0;`}return Z&&(i?Z.prepend(N):Z.appendChild(N)),()=>{Z&&Z.removeChild(N),e.unmount()}}},[Z,_]),a.useLayoutEffect(()=>{R&&(N.className=R)},[R]);let et=a.useMemo(()=>_?{position:"absolute",top:0,left:0,width:H.width,height:H.height,transformStyle:"preserve-3d",pointerEvents:"none"}:{position:"absolute",transform:v?"translate3d(-50%,-50%,0)":"none",...g&&{top:-H.height/2,left:-H.width/2,width:H.width,height:H.height},...n},[n,v,g,H,_]),en=a.useMemo(()=>({position:"absolute",pointerEvents:j}),[j]);a.useLayoutEffect(()=>{var t,i;K.current=!1,_?null==(t=$.current)||t.render(a.createElement("div",{ref:Q,style:et},a.createElement("div",{ref:X,style:en},a.createElement("div",{ref:T,className:r,style:n,children:e})))):null==(i=$.current)||i.render(a.createElement("div",{ref:T,style:et,className:r,children:e}))});let er=a.useRef(!0);(0,u.D)(e=>{if(V.current){q.updateMatrixWorld(),V.current.updateWorldMatrix(!0,!1);let e=_?G.current:k(V.current,q,H);if(_||Math.abs(Y.current-q.zoom)>t||Math.abs(G.current[0]-e[0])>t||Math.abs(G.current[1]-e[1])>t){var n;let t,r,i,o,a=(n=V.current,t=c.setFromMatrixPosition(n.matrixWorld),r=f.setFromMatrixPosition(q.matrixWorld),i=t.sub(r),o=q.getWorldDirection(d),i.angleTo(o)>Math.PI/2),s=!1;ee&&(Array.isArray(A)?s=A.map(e=>e.current):"blending"!==A&&(s=[D]));let u=er.current;s?er.current=function(e,t,n,r){let i=c.setFromMatrixPosition(e.matrixWorld),o=i.clone();o.project(t),p.set(o.x,o.y),n.setFromCamera(p,t);let a=n.intersectObjects(r,!0);if(a.length){let e=a[0].distance;return i.distanceTo(n.ray.origin)<e}return!0}(V.current,q,B,s)&&!a:er.current=!a,u!==er.current&&(M?M(!er.current):N.style.display=er.current?"block":"none");let m=Math.floor(C[0]/2),v=A?ee?[C[0],m]:[m-1,0]:C;if(N.style.zIndex=`${function(e,t,n){if(t instanceof l.ubm||t instanceof l.qUd){let r=c.setFromMatrixPosition(e.matrixWorld),i=f.setFromMatrixPosition(t.matrixWorld),o=r.distanceTo(i),a=(n[1]-n[0])/(t.far-t.near),s=n[1]-a*t.far;return Math.round(a*o+s)}}(V.current,q,v)}`,_){let[e,t]=[H.width/2,H.height/2],n=q.projectionMatrix.elements[5]*t,{isOrthographicCamera:r,top:i,left:o,bottom:a,right:s}=q,l=y(q.matrixWorldInverse),u=r?`scale(${n})translate(${h(-(s+o)/2)}px,${h((i+a)/2)}px)`:`translateZ(${n}px)`,c=V.current.matrixWorld;S&&((c=q.matrixWorldInverse.clone().transpose().copyPosition(c).scale(V.current.scale)).elements[3]=c.elements[7]=c.elements[11]=0,c.elements[15]=1),N.style.width=H.width+"px",N.style.height=H.height+"px",N.style.perspective=r?"":`${n}px`,Q.current&&X.current&&(Q.current.style.transform=`${u}${l}translate(${e}px,${t}px)`,X.current.style.transform=w(c,1/((b||10)/400)))}else{let t=void 0===b?1:function(e,t){if(t instanceof l.qUd)return t.zoom;if(!(t instanceof l.ubm))return 1;{let n=c.setFromMatrixPosition(e.matrixWorld),r=f.setFromMatrixPosition(t.matrixWorld);return 1/(2*Math.tan(t.fov*Math.PI/180/2)*n.distanceTo(r))}}(V.current,q)*b;N.style.transform=`translate3d(${e[0]}px,${e[1]}px,0) scale(${t})`}G.current=e,Y.current=q.zoom}}if(!ee&&J.current&&!K.current)if(_){if(Q.current){let e=Q.current.children[0];if(null!=e&&e.clientWidth&&null!=e&&e.clientHeight){let{isOrthographicCamera:t}=q;if(t||L)I.scale&&(Array.isArray(I.scale)?I.scale instanceof l.Pq0?J.current.scale.copy(I.scale.clone().divideScalar(1)):J.current.scale.set(1/I.scale[0],1/I.scale[1],1/I.scale[2]):J.current.scale.setScalar(1/I.scale));else{let t=(b||10)/400,n=e.clientWidth*t,r=e.clientHeight*t;J.current.scale.set(n,r,1)}K.current=!0}}}else{let t=N.children[0];if(null!=t&&t.clientWidth&&null!=t&&t.clientHeight){let e=1/F.factor,n=t.clientWidth*e,r=t.clientHeight*e;J.current.scale.set(n,r,1),K.current=!0}J.current.lookAt(e.camera.position)}});let ei=a.useMemo(()=>({vertexShader:_?void 0:`
          /*
            This shader is from the THREE's SpriteMaterial.
            We need to turn the backing plane into a Sprite
            (make it always face the camera) if "transfrom"
            is false.
          */
          #include <common>

          void main() {
            vec2 center = vec2(0., 1.);
            float rotation = 0.0;

            // This is somewhat arbitrary, but it seems to work well
            // Need to figure out how to derive this dynamically if it even matters
            float size = 0.03;

            vec4 mvPosition = modelViewMatrix * vec4( 0.0, 0.0, 0.0, 1.0 );
            vec2 scale;
            scale.x = length( vec3( modelMatrix[ 0 ].x, modelMatrix[ 0 ].y, modelMatrix[ 0 ].z ) );
            scale.y = length( vec3( modelMatrix[ 1 ].x, modelMatrix[ 1 ].y, modelMatrix[ 1 ].z ) );

            bool isPerspective = isPerspectiveMatrix( projectionMatrix );
            if ( isPerspective ) scale *= - mvPosition.z;

            vec2 alignedPosition = ( position.xy - ( center - vec2( 0.5 ) ) ) * scale * size;
            vec2 rotatedPosition;
            rotatedPosition.x = cos( rotation ) * alignedPosition.x - sin( rotation ) * alignedPosition.y;
            rotatedPosition.y = sin( rotation ) * alignedPosition.x + cos( rotation ) * alignedPosition.y;
            mvPosition.xy += rotatedPosition;

            gl_Position = projectionMatrix * mvPosition;
          }
      `,fragmentShader:`
        void main() {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        }
      `}),[_]);return a.createElement("group",(0,o.A)({},I,{ref:V}),A&&!ee&&a.createElement("mesh",{castShadow:E,receiveShadow:P,ref:J},L||a.createElement("planeGeometry",null),z||a.createElement("shaderMaterial",{side:l.$EB,vertexShader:ei.vertexShader,fragmentShader:ei.fragmentShader})))})},9857:(e,t,n)=>{n.d(t,{A:()=>r});let r=(0,n(425).A)("menu",[["path",{d:"M4 5h16",key:"1tepv9"}],["path",{d:"M4 12h16",key:"1lakjw"}],["path",{d:"M4 19h16",key:"1djgab"}]])},9928:(e,t,n)=>{n.d(t,{A:()=>r});let r=(0,n(425).A)("linkedin",[["path",{d:"M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z",key:"c2jq9f"}],["rect",{width:"4",height:"12",x:"2",y:"9",key:"mk3on5"}],["circle",{cx:"4",cy:"4",r:"2",key:"bt5ra8"}]])}}]);