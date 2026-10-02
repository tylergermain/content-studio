import { FLOOR, SLAB } from '../../shared/layout';

// The haze: what the sky's fog does to everything drawn (world/sky.ts puts these lines into every
// material that takes fog). It's the weather outside, so indoors the air is clear.

/**
 * The furthest off the haze ever is, however high up you are: past that nothing's built (the grass
 * and the road round the office end there, the city round the roof just past it), so it hides that.
 */
export const HAZE_MAX = 300;
/**
 * The haze thins out with height over the street: past HAZE_CLEAR meters up, every HAZE_ABOVE
 * meters more you see as far again as down on the street (from the roof of six floors, 3.4 times).
 */
const HAZE_CLEAR = 6;
const HAZE_ABOVE = 17.5;

/**
 * How far off something's lost in the haze (with the fog's far edge down on the street at `far`),
 * seen from or standing `above` meters over the street, whichever's higher (see HAZE).
 */
export function hazeReach(above: number, far: number): number {
  return Math.min(HAZE_MAX, far * (1 + Math.max(0, above - HAZE_CLEAR) / HAZE_ABOVE));
}

/** The room, out to the inside faces of its walls (and a hair into them, so they're indoors too). */
const IN = 0.06;
const f = (n: number) => n.toFixed(3);

/**
 * The haze, over three.js's own fog: it thins out with height over the street (see HAZE_ABOVE), as
 * thin as it is at your eye or at what you're looking at, whichever is higher. So from high up you
 * see further, the street below included, and from down on the street the top of the building is
 * as clear as the view from up there. Past HAZE_MAX there's nothing to see, whatever the height.
 *
 * Indoors there's none: from inside the building (any of its floors, and the back office where it's
 * built out), whatever else is inside it is clear, however thick the weather is out of the windows;
 * and looking in from outside, only the air between you and the building is in the way.
 */
export const HAZE_PARS_VERTEX = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vSkyFogAt;
#endif
`;

/** Where the vertex is in the world: the view matrix undone (its rotation's transpose), from the camera. */
export const HAZE_VERTEX = /* glsl */ `
#ifdef USE_FOG
  vSkyFogAt = vec3( dot( viewMatrix[ 0 ].xyz, mvPosition.xyz ), dot( viewMatrix[ 1 ].xyz, mvPosition.xyz ), dot( viewMatrix[ 2 ].xyz, mvPosition.xyz ) ) + cameraPosition;
#endif
`;

export const HAZE_PARS = /* glsl */ `
#ifdef USE_FOG
  varying vec3 vSkyFogAt;
  uniform float skyStreet;
  // On a floor of the office (not up on the roof), and its back office if it has one.
  uniform float skyClear;
  uniform vec4 skyClearWing;
  // Inside the building, from the office floor's slab up: not the open garage under it, nor the balcony.
  bool skyIndoors( vec3 p ) {
    if ( p.y < ${f(-SLAB - 0.05)} ) return false;
    if ( p.x > ${f(FLOOR.minX - IN)} && p.x < ${f(FLOOR.maxX + IN)} && p.z > ${f(FLOOR.minZ - IN)} && p.z < ${f(FLOOR.maxZ + IN)} ) return true;
    return p.x > skyClearWing.x && p.x < skyClearWing.y && p.z > skyClearWing.z && p.z < skyClearWing.w + 0.5;
  }
#endif
`;

export const HAZE = /* glsl */ `
#ifdef USE_FOG
  // How much air there is to see it through. What's indoors is only seen through the air outside:
  // none from inside the building, and from out on the balcony just the bit between you and the wall.
  float skyDepth = vFogDepth;
  if ( skyClear > 0.5 && skyIndoors( vSkyFogAt ) ) {
    vec2 skyWall = clamp( cameraPosition.xz, vec2( ${f(FLOOR.minX)}, ${f(FLOOR.minZ)} ), vec2( ${f(FLOOR.maxX)}, ${f(FLOOR.maxZ)} ) );
    skyDepth = skyIndoors( cameraPosition ) ? 0.0 : min( vFogDepth, distance( cameraPosition.xz, skyWall ) + max( ${f(-SLAB)} - cameraPosition.y, 0.0 ) );
  }
  #ifdef FOG_EXP2
    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * skyDepth * skyDepth );
  #else
    // How many times as far off the haze is as down on the street; and past HAZE_MAX, from 45% of
    // the way there, as the haze on the roof always went.
    float skyReach = 1.0 + max( max( cameraPosition.y, vSkyFogAt.y ) - skyStreet - ${HAZE_CLEAR.toFixed(1)}, 0.0 ) / ${HAZE_ABOVE.toFixed(1)};
    float fogFactor = max( smoothstep( fogNear, fogFar, skyDepth / skyReach ), smoothstep( ${(HAZE_MAX * 0.45).toFixed(1)}, ${HAZE_MAX.toFixed(1)}, skyDepth ) );
  #endif
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
#endif
`;
