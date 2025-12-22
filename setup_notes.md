# Setup Notes - LEV Longevity Trajectory

This component is a standalone React + TypeScript module visualizing longevity escape velocity scenarios.

## Development

The project is initialized with Vite.

1. Navigate to the project directory:
   ```bash
   cd "/Users/kylenmcclintock/Documents/AntiGravity Projects/LEV Longevity Trajectory"
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Run the dev server:
   ```bash
   npm run dev
   ```

3. Open `http://localhost:5173` (or the URL shown in console).

## Structure

- `src/LevLongevityTrajectory.tsx`: Main component.
- `src/lev_math.ts`: Core mathematical logic.
- `src/lev_data_loader.ts`: Life table data utilities.
- `src/LevLongevityTrajectory.css`: Styles.

## Data

The component uses an embedded sample life table (approx US 2021) by default. To use full SSA tables, replace the `embedSampleData` function in `lev_data_loader.ts` to fetch or load your JSON/CSV source.
