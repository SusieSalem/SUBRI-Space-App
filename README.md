# Mission Architect

A 3D browser game built by team !subri for the NASA Space Apps Challenge 2026, "Space Mission Design Game" challenge.

## Status

Playable prototype in two steps, in one continuous world:

1. **Assembly.** You start on the ground at the launch pad. The whole stack stands on the pad: rocket, crew spacecraft and escape tower. Pick parts and a rocket on the left and the stack updates live. The gauges on the right say whether it is ready.
2. **Launch and flight.** The rocket flies under real physics from the pad to the Moon and back, and the camera stays with it the whole way. There are no scene changes or fades: the pad drops away, the sky darkens, the Earth curves below because the rocket is actually climbing.

All part, rocket and engine numbers are placeholders for now, marked `TODO` / `TODO-source` in `src/core/`.

### How the flight works

The physics lives in `src/core/` and has no rendering code in it:

- Gravity from the Earth and the Moon (the Moon moves on its orbit), thrust and propellant use per stage with sea-level and vacuum Isp, drag in an exponential atmosphere that turns with the Earth, and automatic staging when a stage runs dry. Dropped stages keep falling under gravity and drag.
- An autopilot flies the mission like a real one: vertical rise, gravity turn, closed-loop guidance into a ~185 km parking orbit, a trans-lunar injection burn at the moment that sends the spacecraft round the Moon, two course corrections for a free return, service module separation, a lifting re-entry and parachutes.
- You can take over at any time (WASD to steer, Shift/Ctrl throttle, Z full, X cut, T to give control back to the autopilot).
- Time warp (Auto, or 1x to 100,000x), limited to 4x while engines run or inside the atmosphere. Map view (M) shows the predicted path and the Moon's orbit.
- The HUD shows altitude, vertical and orbital speed, apoapsis and periapsis, distance to the Moon, fuel in the current stage, throttle, peak g and mission time.

To run the simulation without the browser, `src/core/simulate.ts` can be loaded in Node (for example through Vite's `ssrLoadModule`) and stepped with `sim.advance(seconds)`.

## The game

In Mission Architect you design a crewed space mission and then fly it. You build the spacecraft part by part, pick a rocket that can lift it, and send your astronaut on the trip. If something in the design is wrong, the mission shows it, and the report explains the root cause so you can go back and fix it.

The first mission is **lunar orbit and return**: get a crew to the Moon and bring them home.

### How a mission goes

1. **Pick a mission.** Each one sets a destination, a duration and a budget.
2. **Build the spacecraft.** Crew capsule, service module (engine and fuel), life support, solar panels, radiation shield. Some parts can't be fitted together.
3. **Watch your resources.** Every part changes mass, power, budget and oxygen. A heavier ship needs a bigger rocket, and a bigger rocket costs more.
4. **Pick a rocket.** Light, Medium or Heavy. It has to be able to send your spacecraft towards the Moon.
5. **Fly it.** Launch, parking orbit, trans-lunar injection, the coast, the swing around the far side of the Moon, the trip home and re-entry. Real events can get in the way, such as solar storms from NASA's DONKI database.
6. **Read the report and redesign.** The report says what went wrong and why, for example not enough oxygen for the days the trip actually took, or no shelter when a solar storm hit.

The astronaut rides inside the capsule and is the player's guide. The game is single player for now.

### Look

The 3D scene uses our own GLSL shaders, written for this project and inspired by common Shadertoy techniques (we don't copy Shadertoy or Minecraft shader-pack code, since most of it is under licences we can't use):

- Earth with continents, ocean sun glint, ice caps, clouds and city lights on the night side, all procedural for now
- An atmosphere shell with real Rayleigh and Mie scattering, so the limb is blue and the light turns orange near the terminator
- The Moon with maria and craters, a starfield with a Milky Way band, and the Sun with a glow
- Bloom, ACES tone mapping and a light vignette
- One planet shader at real scale (`src/scenes/shaders/planet.ts`) draws the Earth, its atmosphere, clouds, the coast at the launch site, the Moon, the Sun and the stars from wherever the camera is, from 2 m above the pad to lunar distance. The world is re-centred on the spacecraft every frame and uses a logarithmic depth buffer, so real distances work without precision problems. There is a High / Low quality switch for slower machines.

The Earth is procedural so the prototype runs without downloading anything. NASA's Blue Marble and Black Marble images can be dropped in later for the day and night sides.

## Tech

- **React + TypeScript**, built with **Vite**
- **three.js** through **React Three Fiber**, **drei** and **@react-three/postprocessing**
- **Blender models (.glb)** mixed with parts built in code. The hero assets are .glb files in `public/models/`, loaded with `useGLTF` and `useAnimations` from drei: a rigged astronaut (who rides in the capsule, gives hints while you build, and reacts at launch and in the report), the rocket and the control room. The spacecraft is put together from separate part models, and any part without a model yet falls back to a simple placeholder shape. If `public/models/astronaut.glb` exists, the prototype already shows it next to the capsule playing its `Idle` animation.
- **Recharts** for resource graphs and the mission report (planned)
- **Firebase** (project `kira-85871`), optional. It is planned for saving and sharing designs and for a leaderboard. Analytics only starts in browsers that support it, so ad blockers or private windows won't break the game.

## 3D assets

Models are made in Blender and go in `public/models/`. When exporting:

- Use glTF Binary (.glb), with +Y up.
- Apply all transforms and modifiers before export.
- Save animations as named actions. The astronaut needs `Idle`, `Wave`, `Talk`, `Celebrate` and `Disappointed`, because the code plays them by name.
- Turn on Draco compression.
- Keep textures at 2K or smaller.

Size budget: the astronaut should stay under 30k triangles and 5 MB, and the whole game under 25 MB.

Run each model through gltf-transform before adding it:

```bash
npx gltf-transform optimize in.glb out.glb --texture-compress webp
```

## NASA data

These are the sources we plan to use. We will add links and exact datasets as each one is wired in.

| Source | What we use it for |
| --- | --- |
| DONKI (Space Weather Database of Notifications, Knowledge, Information) | Solar storms during the mission, and why the crew needs a radiation shelter |
| Orion and Artemis public fact sheets | Reference mass, power and life support values for crew spacecraft parts |
| NASA Ames, State-of-the-Art of Small Spacecraft Technology | Reference values for smaller parts such as solar arrays and avionics |
| Near Space Network | Ground station coverage and communications |
| Blue Marble / Black Marble (NASA Earth Observatory) | Earth day and night imagery for the globe |
| Lunar Reconnaissance Orbiter imagery | Moon surface textures |

## Project layout

```
public/
  models/                Blender exports (.glb)
src/
  main.tsx               Entry point, imports Firebase
  App.tsx                UI: parts panel, readiness gauges, mission controls
  styles.css
  firebase.ts            Firebase app setup, exports `app`
  core/
    design.ts            Spacecraft parts, totals and design checks (placeholder numbers)
    launchCheck.ts       Rockets and whether the spacecraft fits (placeholder numbers)
    orbit.ts             Constants, gravity, atmosphere, orbit elements, trajectory propagator
    simulate.ts          The flight: vehicle, staging, autopilot, planning of the burns
    vehicleData.ts       Stage and engine figures (placeholders, TODO-source)
  scenes/
    FlightScene.tsx      The one scene: floating origin, camera, debris, smoke, orbit lines
    LaunchSite.tsx       Pad, service tower, buildings
    Rocket.tsx           Light / Medium / Heavy stack with the spacecraft on top
    Smoke.ts             GPU smoke particles
    ShaderMat.tsx        ShaderMaterial wrapper that keeps our uniforms object
    SpaceScene.tsx       Earlier scripted space scene (no longer shown; mission.ts still feeds the mini-map component)
    Spacecraft.tsx       Placeholder crew spacecraft built from primitives
    Astronaut.tsx        Loads astronaut.glb if present
    mission.ts           Flight path and mission phases
    shaders/             Our own GLSL: the planet/sky shader, Earth, Moon, stars, engine plume
docs/
  landing-placeholder.html   The hand-made landing page that was in dist/ before the app existed
firebase.json            Firebase Hosting config
.firebaserc              Default Firebase project
```

## Running it locally

You need Node.js 20.19 or newer.

```bash
npm install
npm run dev
```

Then open http://localhost:5173. On the pad, drag to look around the rocket and scroll to zoom. Pick parts and a rocket on the left, check the gauges on the right, and press Launch.

To check that everything compiles:

```bash
npm run build
```

Distances are compressed so the Moon is visible from Earth: in the game it is 16 Earth radii away, the real figure is about 60.

## Deploying

The game is hosted on Firebase Hosting at https://subri-space.web.app (site `subri-space` in project `kira-85871`). `firebase.json` serves the Vite build output in `dist/` and sends every route to `index.html`.

You need the Firebase CLI and access to the project:

```bash
npm install -g firebase-tools
firebase login
```

Then build and deploy:

```bash
npm run build
firebase deploy --only hosting:subri-space
```

## Team

!subri
