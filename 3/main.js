import * as THREE from 'https://threejsfundamentals.org/threejs/resources/threejs/r127/build/three.module.js';
import * as UA from 'https://cdnjs.cloudflare.com/ajax/libs/UAParser.js/0.7.28/ua-parser.min.js';

function init_matrix_hq() {
    const canvas = document.querySelector('#c');
    const renderer = new THREE.WebGLRenderer({ canvas });
    renderer.autoClearColor = true;

    const scale = 1;
    const camera = new THREE.OrthographicCamera(
        -1, // left
        1, // right
        1, // top
        -1, // bottom
        -1, // near,
        1, // far
    );
    const scene = new THREE.Scene();
    const plane = new THREE.PlaneGeometry(10, 10);

    const fragmentShader = `
#include <common>
#ifdef GL_ES
precision highp float;
#endif

uniform vec3 iResolution;
uniform float iTime;

const int ITERATIONS = 40;   //use less value if you need more performance
const float SPEED = 1.;

const float STRIP_CHARS_MIN =  7.;
const float STRIP_CHARS_MAX = 40.;
const float STRIP_CHAR_HEIGHT = 0.15;
const float INV_STRIP_CHAR_HEIGHT = 1. / STRIP_CHAR_HEIGHT;
const float STRIP_CHAR_WIDTH = 0.10;
const float ZCELL_SIZE = 1. * (STRIP_CHAR_HEIGHT * STRIP_CHARS_MAX);  //the multiplier can't be less than 1.
const float XYCELL_SIZE = 12. * STRIP_CHAR_WIDTH;  //the multiplier can't be less than 1.

const int BLOCK_SIZE = 10;  //in cells
const int BLOCK_GAP = 2;    //in cells
const float GAP_SIZE = float(BLOCK_GAP) * XYCELL_SIZE;

const float WALK_SPEED = .3;


//        ----  random  ----

float hash(float v) {
return fract(sin(v)*43758.5453123);
}

float hash(vec2 v) {
return hash(dot(v, vec2(5.3983, 5.4427)));
}

vec2 hash2(vec2 v)
{
v = vec2(v * mat2(127.1, 311.7,  269.5, 183.3));
return fract(sin(v)*43758.5453123);
}

vec4 hash4(vec2 v)
{
vec4 p = vec4(
v[0] * 127.1 + v[1] * 311.7,
v[0] * 269.5 + v[1] * 183.3,
v[0] * 113.5 + v[1] * 271.9,
v[0] * 246.1 + v[1] * 124.6);
return fract(sin(p)*43758.5453123);
}

vec4 hash4(vec3 v)
{
// This was ported / unrolled.
// Fixes Safari which does not have the symbol for mat4x2 and mat4x3
vec4 p = vec4(
v[0] * 127.1 + v[1] * 311.7 + v[2] * 74.7,
v[0] * 269.5 + v[1] *  183.3 + v[2] * 246.1,
v[0] * 113.5 + v[1] *  271.9 + v[2] * 124.6,
v[0] * 271.9 + v[1] *  269.5 + v[2] * 311.7);
return fract(sin(p)*43758.5453123);
}

float modf(float a, float b) {
return a-b * floor(a/b);
}

//        ----  symbols  ----
//  Slightly modified version of "runes" by FabriceNeyret2 -  https://www.shadertoy.com/view/4ltyDM
//  Which is based on "runes" by otaviogood -  https://shadertoy.com/view/MsXSRn

float rune_line(vec2 p, vec2 a, vec2 b) {   // from https://www.shadertoy.com/view/4dcfW8
p -= a, b -= a;
float h = clamp(dot(p, b) / dot(b, b), 0., 1.);   // proj coord on line
return length(p - b * h);                         // dist to segment
}

float rune(vec2 U, vec2 seed, float highlight)
{
float d = 1e5;
for (int i = 0; i < 4; i++)	// number of strokes
{
vec4 pos = hash4(seed);
seed += 1.;

// each rune touches the edge of its box on all 4 sides
if (i == 0) pos.y = .0;
if (i == 1) pos.x = .999;
if (i == 2) pos.x = .0;
if (i == 3) pos.y = .999;
// snap the random line endpoints to a grid 2x3
vec4 snaps = vec4(2, 3, 2, 3);
pos = ( floor(pos * snaps) + .5) / snaps;

if (pos.xy != pos.zw)  //filter out single points (when start and end are the same)
    d = min(d, rune_line(U, pos.xy, pos.zw + .001) ); // closest line
}
return smoothstep(0.1, 0., d) + highlight*smoothstep(0.4, 0., d);
}

float random_char(vec2 outer, vec2 inner, float highlight) {
vec2 seed = vec2(dot(outer, vec2(269.5, 183.3)), dot(outer, vec2(113.5, 271.9)));
return rune(inner, seed, highlight);
}


//        ----  digital rain  ----

// xy - horizontal, z - vertical
vec3 rain(vec3 ro3, vec3 rd3, float time) {
vec4 result = vec4(0.);

// normalized 2d projection
vec2 ro2 = vec2(ro3);
vec2 rd2 = normalize(vec2(rd3));

bool prefer_dx = abs(rd2.x) > abs(rd2.y);
float t3_to_t2 = prefer_dx ? rd3.x / rd2.x : rd3.y / rd2.y;
float inv_t3_to_t2 = 1. / t3_to_t2;

const float INV_BLOCK_SIZE = 1. / float(BLOCK_SIZE);
const float INV_ZCELL_SIZE = 1. / ZCELL_SIZE;

// at first, horizontal space (xy) is divided into cells (which are columns in 3D)
// then each xy-cell is divided into vertical cells (along z) - each of these cells contains one raindrop

ivec3 cell_side = ivec3(step(0., rd3));      //for positive rd.x use cell side with higher x (1) as the next side, for negative - with lower x (0), the same for y and z
ivec3 cell_shift = ivec3(sign(rd3));         //shift to move to the next cell

//  move through xy-cells in the ray direction
float t2 = 0.;  // the ray formula is: ro2 + rd2 * t2, where t2 is positive as the ray has a direction.
ivec2 next_cell = ivec2(floor(ro2/XYCELL_SIZE));  //first cell index where ray origin is located
for (int i=0; i<ITERATIONS; i++) {
ivec2 cell = next_cell;  //save cell value before changing
float t2s = t2;          //and t

//  find the intersection with the nearest side of the current xy-cell (since we know the direction, we only need to check one vertical side and one horizontal side)
vec2 side = vec2(next_cell + cell_side.xy) * XYCELL_SIZE;  //side.x is x coord of the y-axis side, side.y - y of the x-axis side
vec2 t2_side = (side - ro2) / rd2;  // t2_side.x and t2_side.y are two candidates for the next value of t2, we need the nearest
if (t2_side.x < t2_side.y) {
    t2 = t2_side.x;
    next_cell.x += cell_shift.x;  //cross through the y-axis side
} else {
    t2 = t2_side.y;
    next_cell.y += cell_shift.y;  //cross through the x-axis side
}
//now t2 is the value of the end point in the current cell (and the same point is the start value in the next cell)
//  gap cells
vec2 cell_in_block = fract(vec2(cell) * INV_BLOCK_SIZE);
float gap = float(BLOCK_GAP) * INV_BLOCK_SIZE;
if (cell_in_block.x < gap || cell_in_block.y < gap || (cell_in_block.x < (gap+0.1) && cell_in_block.y < (gap+0.1))) {
    continue;
}

//  return to 3d - we have start and end points of the ray segment inside the column (t3s and t3e)
float t3s = t2s * inv_t3_to_t2;

//  move through z-cells of the current column in the ray direction (don't need much to check, two nearest cells are enough)
float pos_z = ro3.z + rd3.z * t3s;
float xycell_hash = hash(vec2(cell));
float z_shift = xycell_hash*11. - time * (0.5 + xycell_hash * 1.0 + xycell_hash * xycell_hash * 1.0 + pow(xycell_hash, 16.) * 3.0);  //a different z shift for each xy column
float char_z_shift = floor(z_shift * INV_STRIP_CHAR_HEIGHT);
z_shift = char_z_shift * STRIP_CHAR_HEIGHT;
int zcell = int(floor((pos_z - z_shift)*INV_ZCELL_SIZE));  //z-cell index

// Note: iterations set to 1 because camera no longer rotates.
for (int j=0; j<1; j++) {  //2 iterations is enough if camera doesn't look much up or down
    //  calcaulate coordinates of the target (raindrop)
    vec4 cell_hash = hash4(vec3(ivec3(cell, zcell)));
    vec4 cell_hash2 = fract(cell_hash * vec4(127.1, 311.7, 271.9, 124.6));

    float chars_count = cell_hash.w * (STRIP_CHARS_MAX - STRIP_CHARS_MIN) + STRIP_CHARS_MIN;
    float target_length = chars_count * STRIP_CHAR_HEIGHT;
    float target_rad = STRIP_CHAR_WIDTH * .5;
    float target_z = (float(zcell)*ZCELL_SIZE + z_shift) + cell_hash.z * (ZCELL_SIZE - target_length);
    vec2 target = vec2(cell) * XYCELL_SIZE + target_rad + cell_hash.xy * (XYCELL_SIZE - target_rad*2.);

    //  We have a line segment (t0,t). Now calculate the distance between line segment and cell target (it's easier in 2d)
    vec2 s = target - ro2;
    float tmin = dot(s, rd2);  //tmin - point with minimal distance to target
    if (tmin >= t2s && tmin <= t2) {
        float u = s.x * rd2.y - s.y * rd2.x;  //horizontal coord in the matrix strip
        if (abs(u) < target_rad) {
            u = (u/target_rad + 1.) / 2.;
            float z = ro3.z + rd3.z * tmin/t3_to_t2;
            float v = (z - target_z) / target_length;  //vertical coord in the matrix strip
            if (v >= 0.0 && v < 1.0) {
                float c = floor(v * chars_count);  //symbol index relative to the start of the strip, with addition of char_z_shift it becomes an index relative to the whole cell
                float q = fract(v * chars_count);
                vec2 char_hash = hash2(vec2(c+char_z_shift, cell_hash2.x));
                if (char_hash.x >= 0.1 || c == 0.) {  //10% of missed symbols
                    float time_factor = floor(
                            c == 0. ? time*5.0 :  //first symbol is changed fast
                            time*(1.0*cell_hash2.z +   //strips are changed sometime with different speed
                                    cell_hash2.w*cell_hash2.w*4.*pow(char_hash.y, 4.)));  //some symbols in some strips are changed relatively often
                    float a = random_char(
                        vec2(char_hash.x, modf(time_factor, 60.0)),
                        vec2(u,q),
                        max(1., 3. - c/2.)*0.2);  //alpha
                    a *= clamp((chars_count - 0.5 - c) / 2., 0., 1.);  //tail fade
                    if (a > 0.) {
                        float attenuation = 1. + pow(0.06*tmin/t3_to_t2, 2.);
                        vec3 col = (c == 0. ? vec3(0.67, 1.0, 0.82) : vec3(0.25, 0.80, 0.40)) / attenuation;
                        float a1 = result.a;
                        result.a = a1 + (1. - a1) * a;
                        result.xyz = (result.xyz * a1 + col * (1. - a1) * a) / result.a;
                        if (result.a > 0.98)  return result.xyz;
                    }
                }
            }
        }
    }
    // not found in this cell - go to next vertical cell
    zcell += cell_shift.z;
}
// go to next horizontal cell
}

return result.xyz * result.a;
}


void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
if (STRIP_CHAR_WIDTH > XYCELL_SIZE || STRIP_CHAR_HEIGHT * STRIP_CHARS_MAX > ZCELL_SIZE) {
// error
fragColor = vec4(1., 0., 0., 1.);
return;
}

vec2 uv = (fragCoord.xy * 2. - iResolution.xy) / iResolution.y;
float time = iTime * SPEED;
vec3 ro = vec3(GAP_SIZE/2., GAP_SIZE/2., 0.);
vec3 rd = vec3(uv.x, 2.0, uv.y);

//  move forward
ro.xy += vec2(0.,0.) * 4. + vec2(0.,1.) * (1. * time*WALK_SPEED);

ro += rd * 0.2;
rd = normalize(rd);

float t = time;
vec3 col = rain(ro, rd, time);

fragColor = vec4(col, 1.);
fragColor.r = fragColor.b = fragColor.g;
}

void main() {
mainImage(gl_FragColor, gl_FragCoord.xy);
}
`;
    let clock = new THREE.Clock();
    const uniforms = {
        iTime: { value: 0 },
        iResolution: { value: new THREE.Vector3() },
    };
    const material = new THREE.ShaderMaterial({
        fragmentShader,
        uniforms,
    });
    scene.add(new THREE.Mesh(plane, material));
    function resizeRendererToDisplaySize(renderer) {
        const canvas = renderer.domElement;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        const needResize = canvas.width !== width || canvas.height !== height;
        if (needResize) {
            renderer.setSize(width*scale, height*scale, false);
        }
        return needResize;
    }


    function render(time) {
        //time *= 0.001;  // convert to seconds
        resizeRendererToDisplaySize(renderer);
        const canvas = renderer.domElement;
        uniforms.iResolution.value.set(canvas.width, canvas.height, 1);
        uniforms.iTime.value = clock.getElapsedTime();
        // Reset clock every 4 hours to eliminate the long running
        // precision problems with large floats for large time values.
        if (uniforms.iTime.value > 60*60*4) {
            // Resets the time value.
            clock = new THREE.Clock();
        }
        renderer.render(scene, camera);
        requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
}


function init_matrix_lq() {
    const canvas = document.querySelector('#c');
    const renderer = new THREE.WebGLRenderer({ canvas });
    renderer.autoClearColor = true;

    const scale = 1;
    const camera = new THREE.OrthographicCamera(
        -1, // left
        1, // right
        1, // top
        -1, // bottom
        -1, // near,
        1, // far
    );
    const scene = new THREE.Scene();
    const plane = new THREE.PlaneGeometry(10, 10);

    const fragmentShader = `
#include <common>
#ifdef GL_ES
precision highp float;
#endif

#define texture texture2D

// 256x256 png.
const vec2 iChannelResolution1 = vec2(256, 256);

uniform sampler2D iChannel0;
uniform sampler2D iChannel1;

uniform vec3 iResolution;
uniform float iTime;

float text(vec2 fragCoord)
{
vec2 uv = mod(fragCoord.xy, 16.)*.0625;
vec2 block = fragCoord*.0625 - uv;
uv = uv*.8+.1; // scale the letters up a bit
uv += floor(
texture(iChannel1,
        block/iChannelResolution1.xy + iTime*.002
).xy * 16.
); // randomize letters
uv *= .0625; // bring back into 0-1 range
uv.x = -uv.x; // flip letters horizontally
return texture(iChannel0, uv).r;
}

vec3 rain(vec2 fragCoord)
{
fragCoord.x -= mod(fragCoord.x, 16.);
float offset=sin(fragCoord.x*15.);
float speed=cos(fragCoord.x*3.)*.3+.7;
float y = fract(fragCoord.y/iResolution.y + iTime*speed*.5 + offset);
return vec3(.1,1,.35) / (y*20.);
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
fragColor = vec4(text(fragCoord)*rain(fragCoord),1.0);
// Black and white.
fragColor.r = fragColor.b = fragColor.g;
}

void main() {
mainImage(gl_FragColor, gl_FragCoord.xy);
}
`;

    const clock = new THREE.Clock();
    const loader = new THREE.TextureLoader();
    const tex0 = loader.load('./glyph.png');
    const tex1 = loader.load('./random.png');
    //tex0.minFilter = THREE.NearestFilter;
    //tex0.magFilter = THREE.NearestFilter;
    tex0.wrapS = THREE.RepeatWrapping;
    tex0.wrapT = THREE.RepeatWrapping;

    //tex1.minFilter = THREE.NearestFilter;
    //tex1.magFilter = THREE.NearestFilter;
    tex1.wrapS = THREE.RepeatWrapping;
    tex1.wrapT = THREE.RepeatWrapping;

    const uniforms = {
        iTime: { value: 0 },
        iResolution: { value: new THREE.Vector3() },
        iChannel0: { value: tex0 },
        iChannel1: { value: tex1 },
    };
    const material = new THREE.ShaderMaterial({
        fragmentShader,
        uniforms,
    });
    scene.add(new THREE.Mesh(plane, material));
    function resizeRendererToDisplaySize(renderer) {
        const canvas = renderer.domElement;
        const width = canvas.clientWidth;
        const height = canvas.clientHeight;
        const needResize = canvas.width !== width || canvas.height !== height;
        if (needResize) {
            renderer.setSize(width*scale, height*scale, false);
        }
        return needResize;
    }

    function render(time) {
        //time *= 0.001;  // convert to seconds
        resizeRendererToDisplaySize(renderer);
        const canvas = renderer.domElement;
        uniforms.iResolution.value.set(canvas.width, canvas.height, 1);
        uniforms.iTime.value = clock.getElapsedTime();
        renderer.render(scene, camera);
        requestAnimationFrame(render);
    }
    requestAnimationFrame(render);
}


function query_high_performance() {
    let sysinfo = new UAParser();
    /*
    console.log(sysinfo.getResult());
    console.log(sysinfo.getOS());
    console.log(sysinfo.getEngine());
    console.log(sysinfo);
    */
    const os_name = sysinfo.getOS().name;
    // Only recent chrome on Windows or Mac desktop can deliver
    // good performance with this shader.
    if (os_name === "Windows" || os_name === "Mac OS") {
        if (sysinfo.getEngine().name === "Blink") {
            const version = sysinfo.getEngine().version;
            const major_version = version.split('.').slice(0,1);
            return Number.parseInt(major_version, 10) >= 90;
        }
    }
    return false;
}


function init_main() {
    const high_perf = query_high_performance();
    if (high_perf) {
        init_matrix_hq();
    } else {
        init_matrix_lq();
    }    
}

init_main();