/**
 * The catalog. Everything the plate knows about a metric lives here, so the
 * server and the front end can't drift apart on labels, units or direction.
 *
 * `better` says which way is good — it's what lets a note read "elevated"
 * rather than just "changed". Some metrics genuinely have no direction
 * (wrist temperature matters as a deviation), and those are null.
 *
 * `reference` is a broad population range, used only to give a new install
 * something to say on day one. Personal baselines replace it as soon as
 * there are enough days in the database. It is context, not a diagnosis.
 *
 * `scale` is [worst, best] across the whole plausible physiological span,
 * and it is what drives the figure. It has to be separate from `reference`:
 * if you score against the ideal band, every value outside it pins to zero
 * and the plate renders a uniformly dead body with no shape to read. The
 * scale keeps grading you all the way down, which is the honest picture and
 * also the useful one — you can see which system is worst off.
 */

export const ORGANS = {
  brain: { label: "Cerebrum", blurb: "Sleep and overnight recovery" },
  lungs: { label: "Pulmones", blurb: "Breathing and oxygenation" },
  heart: { label: "Cor", blurb: "Rate, variability and recovery" },
  vasc: { label: "Arteriae", blurb: "Circulation and daily effort" },
  legs: { label: "Membra", blurb: "Gait, pace and distance" }
};

export const METRICS = {
  resting_heart_rate: {
    label: "Resting rate", organ: "heart", unit: "bpm", precision: 0,
    better: "low", reference: [50, 70], scale: [100, 45],
    blurb: "The number that falls furthest when a smoker quits."
  },
  heart_rate: {
    label: "Heart rate", organ: "heart", unit: "bpm", precision: 0,
    better: "low", reference: [55, 85], scale: [110, 55], hasRange: true,
    blurb: "Daily average, with the day's floor and ceiling."
  },
  heart_rate_variability: {
    label: "Heart variability", organ: "heart", unit: "ms", precision: 1,
    better: "high", reference: [30, 90], scale: [10, 100],
    blurb: "Beat-to-beat spacing. Rises with recovery, falls with strain."
  },
  walking_heart_rate_average: {
    label: "Walking rate", organ: "heart", unit: "bpm", precision: 0,
    better: "low", reference: [75, 100], scale: [130, 70],
    blurb: "What it costs you to walk. Drops as fitness climbs."
  },

  respiratory_rate: {
    label: "Breathing rate", organ: "lungs", unit: "br/min", precision: 1,
    better: "low", reference: [12, 20], scale: [26, 11],
    blurb: "Breaths per minute while asleep."
  },
  blood_oxygen_saturation: {
    label: "Blood oxygen", organ: "lungs", unit: "%", precision: 1,
    better: "high", reference: [95, 100], scale: [90, 100],
    blurb: "Oxygen saturation. Carbon monoxide from smoke competes for the same sites."
  },
  breathing_disturbances: {
    label: "Breathing disturbances", organ: "lungs", unit: "/hr", precision: 2,
    better: "low", reference: [0, 5], scale: [15, 0],
    blurb: "Interruptions detected overnight."
  },

  sleep_analysis: {
    label: "Sleep", organ: "brain", unit: "hrs", precision: 1,
    better: "high", reference: [7, 9], scale: [3.5, 8.5], hasStages: true,
    blurb: "Total sleep, with the stage breakdown."
  },
  apple_sleeping_wrist_temperature: {
    label: "Wrist temperature", organ: "brain", unit: "°C", precision: 2,
    better: null, reference: null, scale: null,
    blurb: "Only the deviation from your own baseline means anything."
  },

  physical_effort: {
    label: "Physical effort", organ: "vasc", unit: "kcal/hr·kg", precision: 2,
    better: "high", reference: [2, 6], scale: [0, 8],
    blurb: "Intensity of the day's movement."
  },
  active_energy: {
    label: "Active energy", organ: "vasc", unit: "kcal", precision: 0,
    better: "high", reference: [300, 700], scale: [0, 800],
    blurb: "Burned above resting."
  },
  apple_exercise_time: {
    label: "Exercise", organ: "vasc", unit: "min", precision: 0,
    better: "high", reference: [30, 60], scale: [0, 60],
    blurb: "Minutes at brisk-walk intensity or above."
  },
  time_in_daylight: {
    label: "Daylight", organ: "vasc", unit: "min", precision: 0,
    better: "high", reference: [60, 180], scale: [0, 180],
    blurb: "Outdoor light exposure, which drives the sleep clock."
  },

  step_count: {
    label: "Steps", organ: "legs", unit: "steps", precision: 0,
    better: "high", reference: [7000, 10000], scale: [0, 12000],
    blurb: "The charge rising through the legs."
  },
  walking_running_distance: {
    label: "Distance", organ: "legs", unit: "km", precision: 2,
    better: "high", reference: [5, 8], scale: [0, 8],
    blurb: "Ground covered on foot."
  },
  walking_speed: {
    label: "Walking speed", organ: "legs", unit: "km/h", precision: 2,
    better: "high", reference: [4.8, 5.6], scale: [2.5, 6.0],
    blurb: "Usual pace. One of the better general fitness markers there is."
  },
  walking_step_length: {
    label: "Step length", organ: "legs", unit: "cm", precision: 1,
    better: "high", reference: [66, 78], scale: [45, 80],
    blurb: "Shortens when you are tired, cautious or unwell."
  },
  walking_asymmetry_percentage: {
    label: "Gait asymmetry", organ: "legs", unit: "%", precision: 1,
    better: "low", reference: [0, 3], scale: [8, 0],
    blurb: "How unevenly the two legs carry you. This is what tilts the plate."
  },
  walking_double_support_percentage: {
    label: "Double support", organ: "legs", unit: "%", precision: 1,
    better: "low", reference: [20, 30], scale: [40, 18],
    blurb: "Share of each stride with both feet down. Rises when balance is poor."
  },

  apple_stand_hour: {
    label: "Stand hours", organ: "vasc", unit: "hrs", precision: 0,
    better: "high", reference: [10, 14], scale: [0, 14], blurb: "Hours with at least a minute on your feet."
  },
  apple_stand_time: {
    label: "Stand time", organ: "vasc", unit: "min", precision: 0,
    better: "high", reference: [180, 400], scale: [0, 420], blurb: "Total time upright."
  },
  basal_energy_burned: {
    label: "Basal energy", organ: "vasc", unit: "kcal", precision: 0,
    better: null, reference: null, scale: null, blurb: "What your body spends staying alive."
  }
};

/** Metrics shown on the figure itself, in plate order. */
export const PLATE_ORDER = [
  "sleep_analysis",
  "respiratory_rate",
  "resting_heart_rate",
  "heart_rate_variability",
  "step_count"
];

export const metricInfo = name =>
  METRICS[name] ?? {
    label: name.replace(/_/g, " "),
    organ: null, unit: "", precision: 2, better: null, reference: null,
    blurb: "Captured but not yet mapped to the plate."
  };

/**
 * Nothing here measures a cigarette. Smoking state is logged by hand and
 * kept explicitly separate from sensor data so the plate never implies
 * the watch detected something it cannot.
 */
export const MODELLED = {
  tar_load: {
    label: "Tar load", organ: "lungs",
    blurb: "Modelled from your quit date, not measured. Cilia recover over roughly nine months."
  }
};
