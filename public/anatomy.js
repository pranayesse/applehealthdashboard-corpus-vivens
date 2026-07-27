/**
 * Figure geometry, in a 560x900 viewBox with the midline at x=280.
 *
 * The torso is authored as a right half and mirrored, so the figure cannot
 * drift out of symmetry through a typo in a control point. Limbs are
 * separate closed shapes drawn behind the torso, which is what keeps the
 * gaps between arm and ribcage clean.
 */

const CX = 280;
const S = v => v.toFixed(1);
const seg = (c1, c2, p) => ({ c1, c2, p });

function mirrorClosed(start, segs) {
  const mx = x => 2 * CX - x;
  const pts = [start, ...segs.map(s => s.p)];
  let d = `M ${S(start[0])} ${S(start[1])}`;
  for (const s of segs) {
    d += ` C ${S(s.c1[0])} ${S(s.c1[1])} ${S(s.c2[0])} ${S(s.c2[1])} ${S(s.p[0])} ${S(s.p[1])}`;
  }
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i], prev = pts[i];
    d += ` C ${S(mx(s.c2[0]))} ${S(s.c2[1])} ${S(mx(s.c1[0]))} ${S(s.c1[1])} ${S(mx(prev[0]))} ${S(prev[1])}`;
  }
  return d + " Z";
}

export const TORSO = mirrorClosed([280, 40], [
  seg([304, 40], [316, 64], [316, 96]),      // skull
  seg([316, 120], [306, 140], [294, 150]),   // temple, jaw
  seg([292, 160], [291, 172], [291, 184]),   // neck
  seg([318, 190], [348, 197], [366, 210]),   // trapezius
  seg([376, 217], [377, 231], [371, 243]),   // deltoid cap
  seg([364, 251], [354, 256], [348, 264]),   // armpit
  seg([344, 298], [340, 330], [336, 358]),   // ribs
  seg([332, 382], [329, 398], [329, 412]),   // waist
  seg([335, 436], [346, 452], [350, 472]),   // iliac crest
  seg([348, 492], [328, 502], [304, 504]),   // pelvic floor
  seg([296, 505], [288, 505], [280, 505])
]);

export const LEG =
  "M 284 484 C 306 480 332 484 346 492 C 353 522 355 568 351 616 " +
  "C 348 648 343 674 339 702 C 335 738 329 782 323 818 " +
  "C 321 836 319 848 317 856 C 315 864 305 866 297 864 " +
  "C 291 862 289 854 289 844 C 289 812 290 776 290 742 " +
  "C 290 700 288 660 287 622 C 286 574 284 526 284 484 Z";

export const ARM =
  "M 366 196 C 382 204 390 222 391 246 C 392 280 389 316 386 352 " +
  "C 384 378 381 402 379 426 C 377 456 374 486 371 508 " +
  "C 369 524 370 540 366 550 C 362 560 352 560 349 550 " +
  "C 346 538 348 522 350 506 C 353 480 356 452 358 426 " +
  "C 360 396 362 360 361 326 C 360 288 358 246 358 220 " +
  "C 358 204 360 194 366 196 Z";

export const MIRROR = "scale(-1,1) translate(-560,0)";

export const BRAIN =
  "M 280 58 C 297 58 310 71 310 88 C 310 105 300 117 290 119 " +
  "C 283 120 277 120 270 119 C 260 117 250 105 250 88 C 250 71 263 58 280 58 Z";

/* the subject's left lung carries the cardiac notch */
export const LUNG_R =
  "M 270 212 C 254 216 240 236 234 262 C 228 292 230 324 236 344 " +
  "C 240 356 254 359 264 355 C 271 351 274 341 274 328 L 274 226 " +
  "C 274 216 274 212 270 212 Z";

export const LUNG_L =
  "M 290 212 C 306 216 320 236 326 262 C 332 292 330 324 324 344 " +
  "C 320 356 306 359 297 355 C 292 352 290 346 289 339 " +
  "C 296 328 298 314 296 301 C 294 288 290 281 287 274 L 287 226 " +
  "C 287 216 287 212 290 212 Z";

export const HEART =
  "M 281 271 C 292 266 305 270 310 282 C 315 295 311 312 303 324 " +
  "C 296 334 288 340 283 337 C 276 331 271 316 271 298 " +
  "C 271 285 275 274 281 271 Z";

/** Arteries, routed to stay inside the silhouette. */
export const VESSELS = [
  "M 296 274 C 301 260 293 249 283 251 C 276 252 274 260 275 270",
  "M 279 266 C 280 320 281 390 280 460",
  "M 280 460 C 288 476 300 490 306 512 C 312 552 314 610 315 664 C 316 716 316 776 316 826",
  "M 280 460 C 272 476 260 490 254 512 C 248 552 246 610 245 664 C 244 716 244 776 244 826",
  "M 285 251 C 287 222 288 202 289 188 C 289 181 289 176 289 171",
  "M 275 251 C 273 222 272 202 271 188 C 271 181 271 176 271 171",
  "M 300 258 C 322 250 344 258 358 274 C 366 306 368 356 366 412 C 365 452 362 486 359 512",
  "M 260 258 C 238 250 216 258 202 274 C 194 306 192 356 194 412 C 195 452 198 486 201 512"
];

/** Where each label attaches, and where its text sits in the margin. */
export const TAGS = [
  { id: "brain", organ: "brain", metric: "sleep_analysis",
    name: "Cerebrum", at: [248, 90], to: [146, 92], side: "end" },
  { id: "lungs", organ: "lungs", metric: "respiratory_rate",
    name: "Pulmones", at: [238, 276], to: [146, 258], side: "end" },
  { id: "heart", organ: "heart", metric: "resting_heart_rate",
    name: "Cor", at: [308, 300], to: [418, 284], side: "start" },
  { id: "vasc", organ: "vasc", metric: "heart_rate_variability",
    name: "Arteriae", at: [282, 438], to: [418, 432], side: "start" },
  { id: "legs", organ: "legs", metric: "step_count",
    name: "Membra", at: [300, 690], to: [146, 676], side: "end" }
];

/** Vertical bounds of the leg charge gauge. */
export const LEG_GAUGE = { bottom: 870, top: 500 };
