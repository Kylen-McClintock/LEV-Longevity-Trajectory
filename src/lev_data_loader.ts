
export type LifeTable = {
  ages: number[];
  qx: number[];
  source: string;
  year: number;
};

// Simplified sample data approx USA 2021 (randomized/smoothed for demo)
// In a real app, this would be a larger JSON file.
// We only include a subset of ages for the sample, but the loader will extrapolate.
const SAMPLE_MALE_QX: [number, number][] = [
  [0, 0.006], [10, 0.0001], [20, 0.0013], [30, 0.0022], [40, 0.0035],
  [50, 0.0068], [60, 0.013], [70, 0.026], [80, 0.055], [90, 0.13],
  [100, 0.28], [110, 0.50]
];

const SAMPLE_FEMALE_QX: [number, number][] = [
  [0, 0.005], [10, 0.0001], [20, 0.0006], [30, 0.0010], [40, 0.0020],
  [50, 0.0045], [60, 0.008], [70, 0.019], [80, 0.042], [90, 0.10],
  [100, 0.24], [110, 0.48]
];

// Utility to interpolate/extrapolate qx
function interpolateQx(age: number, data: [number, number][]): number {
  // Find surrounding points
  if (age <= data[0][0]) return data[0][1];
  if (age >= data[data.length - 1][0]) return data[data.length - 1][1]; // Will be handled by Gompertz later

  for (let i = 0; i < data.length - 1; i++) {
    const [a1, q1] = data[i];
    const [a2, q2] = data[i+1];
    if (age >= a1 && age <= a2) {
      const t = (age - a1) / (a2 - a1);
      // Log-linear interpolation for probabilities is often better, but linear is fine for this rough sample
      return q1 + t * (q2 - q1);
    }
  }
  return 0.99;
}

// Gompertz extrapolation constants (derived from typical human mortality)
// h(x) = A * exp(B * x) -> log(h) = lnA + Bx
// We will fit the last valid data points.

export function embedSampleData(sex: 'male' | 'female'): LifeTable {
  const sourceData = sex === 'male' ? SAMPLE_MALE_QX : SAMPLE_FEMALE_QX;
  const ages: number[] = [];
  const qx: number[] = [];
  
  // 1. Fill 0..110 from sample interpolation
  for (let a = 0; a <= 110; a++) {
    ages.push(a);
    qx.push(interpolateQx(a, sourceData));
  }

  // 2. Extrapolate to 150 using Gompertz fit on ages 90-110
  // h = -ln(1-q). Fit log(h) = alpha + beta*x
  // Simple fit: take two points (90, 110)
  const x1 = 90, x2 = 110;
  const q1 = interpolateQx(x1, sourceData);
  const q2 = interpolateQx(x2, sourceData);
  const h1 = -Math.log(1 - q1);
  const h2 = -Math.log(1 - q2);
  
  const B = (Math.log(h2) - Math.log(h1)) / (x2 - x1);
  const A = h1 / Math.exp(B * x1);

  // Extrapolate 111..150
  for (let a = 111; a <= 150; a++) {
    ages.push(a);
    const predictedH = A * Math.exp(B * a);
    const predictedQ = 1 - Math.exp(-predictedH);
    qx.push(Math.min(0.999, predictedQ));
  }

  return {
    ages,
    qx,
    source: "Embedded Sample (Approx US 2021)",
    year: 2021
  };
}
