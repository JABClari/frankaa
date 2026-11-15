var t=`precision mediump float;
varying vec2 vUv;
uniform sampler2D uPreview;
uniform sampler2D uNoise;
uniform float uHasPreview;
uniform float uTime;
uniform vec2 uResolution;
uniform float uFailed;
float n(vec2 p){
vec2 i=floor(p),f=fract(p);
return texture2D(uNoise,(i+f*f*(3.0-2.0*f)+0.5)/64.0).r;
}
float fbm(vec2 p){
float v=0.0,a=0.5;
for(int i=0;i<5;i++){v+=a*n(p);p=mod(p*2.03+0.37,64.0);a*=0.5;}
return v;
}
float grain(){
vec2 o=mod(floor(uTime*24.0),64.0)*vec2(13.0,7.0);
return texture2D(uNoise,mod(gl_FragCoord.xy+o,64.0)/64.0).g-0.5;
}
vec3 blurPrev(vec2 uv,float r){
vec3 c=vec3(0.0);
float w=0.0;
for(int x=-2;x<=2;x++)for(int y=-2;y<=2;y++){
float k=1.0-length(vec2(float(x),float(y)))/3.2;
c+=texture2D(uPreview,clamp(uv+vec2(float(x),float(y))*r,0.0,1.0)).rgb*k;
w+=k;
}
return c/w;
}
vec3 neutral(vec2 uv){return mix(vec3(0.11,0.12,0.13),vec3(0.17,0.18,0.2),fbm(uv*2.0+uTime*0.05));}
vec3 dim(vec3 c){return uFailed>0.5?mix(c,vec3(0.1,0.11,0.12),0.55):c;}`,o={film:{fragment:t+`vec3 thinFilm(float t){return 0.5+0.5*cos(6.2831*(t+vec3(0.0,0.33,0.67)));}
void main(){
vec2 uv=vUv;
float t=uTime;
vec3 base=uHasPreview>0.5?blurPrev(uv,0.005):neutral(uv);
float th=fbm(uv*2.2+vec2(t*0.06,-t*0.04))*1.6+uv.y*0.4;
vec3 film=thinFilm(th);
float fres=0.35+0.45*smoothstep(0.25,0.85,fbm(uv*1.4-t*0.05));
vec3 col=mix(base,base*0.68+film*0.42,fres*0.8);
col+=grain()*0.025;
gl_FragColor=vec4(dim(col),1.0);
}`},none:{fragment:t+`void main(){
vec3 col=uHasPreview>0.5?blurPrev(vUv,0.005):mix(vec3(0.11,0.12,0.13),vec3(0.17,0.18,0.2),0.5-vUv.y*0.3);
gl_FragColor=vec4(dim(col),1.0);
}`}};function i(e,r){if(!r||typeof r.fragment!="string")throw new TypeError("frankaa: a loading material needs a fragment shader");o[e]=r}var a=e=>o[e],v=()=>Object.keys(o);export{t as a,i as b,a as c,v as d};
