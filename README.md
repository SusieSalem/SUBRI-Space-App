# Mission Architect

A 3D browser game built by team !subri for the NASA Space Apps Challenge 2026, "Space Mission Design Game" challenge.

## Status

Playable prototype in three steps, in one continuous world:

1. **Assembly.** You start on the ground at the launch pad. The whole stack stands on the pad: rocket, crew spacecraft and escape tower. Pick parts and a rocket on the left and the stack updates live. The gauges on the right say whether it is ready. You also pick the launch weather and a real solar storm from NASA's DONKI archive to fly through.
2. **Orbit planning.** Like a maneuver node in an orbit game, you set three numbers: the height of the parking orbit, the burn point (how far ahead the Moon is when you fire) and the delta-v of the trans-lunar burn. A map shows the predicted trip to the Moon and back and three checks tell you whether it reaches the Moon, has enough propellant and comes home. The prediction flies the real burn and the autopilot's course corrections on a copy of the flight, so what you plan is what you fly. You can also launch straight away with the autopilot's own plan.
3. **Launch and flight.** The rocket flies under real physics from the pad to the Moon and back, and the camera stays with it the whole way. There are no scene changes or fades: the pad drops away, the sky darkens, the Earth curves below because the rocket is actually climbing. Your flight is compared live with NASA's real Artemis II trajectory.

Part, rocket, and engine numbers in `src/core/` are loaded from `public/data/crewed_lunar.json` (sourced NASA Orion CM, ESA European Service Module, SLS Block 1, Falcon 9 / Falcon Heavy and Vulcan Centaur figures, typed by `CrewedLunarDataset` in `src/types/mission.ts`). With them, the flight simulation flies the dataset's reference designs end to end: `crewed_flyby` on Medium and `crewed_min_orbit` / `crewed_full_artemis` on Heavy reach the Moon and splash down; Light reaches orbit but cannot send the capsule to the Moon.

### How the flight works

The physics live in `src/core/` and have no rendering code in them:

- Gravity from the Earth and the Moon (the Moon moves on its orbit), thrust and propellant use per stage with sea-level and vacuum Isp, drag in an exponential atmosphere that turns with the Earth, and automatic staging when a stage runs dry. Dropped stages keep falling under gravity and drag.
- The Moon goes round the Earth the same way the Earth turns (prograde), like the real one, and the trip is planned to meet it: the trans-lunar burn happens when the Moon is the chosen angle ahead, so that the Moon arrives where the spacecraft crosses its orbit about four days later.
- An autopilot flies the mission like a real one: vertical rise, gravity turn, closed-loop guidance to the parking orbit (coast to apoapsis, then circularise), a trans-lunar injection burn at the moment that sends the spacecraft round the Moon (yours from the planner, or its own free-return search), course corrections for a free return, service module separation, a lifting re-entry and parachutes.
- Life support runs out: the capsule and life support parts give the days of oxygen, water and CO2 scrubbing on board, counted from liftoff. A trip that takes longer than that loses the crew.
- When the flight ends, `src/core/missionReport.ts` builds the mission report: success, partial or failure, the root cause first (for example "life support ran out 80 h before splashdown" or "the way home missed the Earth, and there was no propellant left to correct it"), then every other finding with its numbers and what to change: re-entry load, life support and propellant margins, the solar storm and the budget.
- You can take over at any time (`WASD` to steer, `Shift`/`Ctrl` throttle, `Z` full, `X` cut, `T` to give control back to the autopilot).
- Time warp (`Auto`, or `1x` to `100,000x`), limited to `4x` while engines run or inside the atmosphere. Map view (`M`) shows the predicted path and the Moon's orbit.
- The HUD shows altitude, vertical and orbital speed, apoapsis and periapsis, distance to the Moon, fuel in the current stage, throttle, peak g and mission time.

To run the simulation without the browser, `src/core/simulate.ts` can be loaded in Node (for example through Vite's `ssrLoadModule`) and stepped with `sim.advance(seconds)`. The orbit planner's prediction (`src/core/orbitPlan.ts`) runs the same code in a web worker (`src/core/planWorker.ts`) so dragging the controls stays smooth.

## The game

In Mission Architect you design a crewed space mission and then fly it. You build the spacecraft part by part, pick a rocket that can lift it, and send your astronaut on the trip. If something in the design is wrong, the mission shows it, and the report explains the root cause so you can go back and fix it.

The first mission is **lunar orbit and return**: get a crew to the Moon and bring them home.

### How a mission goes

1. **The mission.** There is one: a crewed lunar orbit and return (Artemis-class). It sets the destination, the life support days needed and the budget.
2. **Build the spacecraft.** Crew capsule, service module (engine and fuel), life support, solar panels, radiation shield. Some parts can't be fitted together.
3. **Watch your resources.** Every part changes mass, power, budget and oxygen. A heavier ship needs a bigger rocket, and a bigger rocket costs more.
4. **Pick a rocket.** Light, Medium or Heavy. It has to be able to send your spacecraft towards the Moon.
5. **Fly it.** Launch, parking orbit, trans-lunar injection, the coast, the swing around the far side of the Moon, the trip home and re-entry. Real events can get in the way, such as solar storms from NASA's DONKI database.
6. **Read the report and redesign.** The report says what went wrong and why, for example not enough oxygen for the days the trip actually took, or no shelter when a solar storm hit.

The astronaut rides inside the capsule and is the player's guide. The game is single player for now.

### Look

The 3D scene uses our own GLSL shaders, written for this project and inspired by common Shadertoy techniques (we don't copy Shadertoy or Minecraft shader-pack code, since most of it is under licences we can't use):

- Earth from NASA's Blue Marble (day), Black Marble (city lights at night) and a land/water mask, with ocean sun glint and procedural clouds
- An atmosphere shell with real Rayleigh and Mie scattering, so the limb is blue and the light turns orange near the terminator
- The Moon from NASA's LRO colour map (CGI Moon Kit), with the near side facing the Earth; a starfield with a Milky Way band, and the Sun with a glow
- Bloom, ACES tone mapping and a light vignette
- One planet shader at real scale (`src/scenes/shaders/planet.ts`) draws the Earth, its atmosphere, clouds, the coast at the launch site, the Moon, the Sun and the stars from wherever the camera is, from 2 m above the pad to lunar distance. The world is re-centred on the spacecraft every frame and uses a logarithmic depth buffer, so real distances work without precision problems. There is a `High` / `Low` quality switch for slower machines.

The Earth and Moon textures are 2K NASA images in `public/textures/`, bundled with the game, so it runs offline.

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

## NASA data & archived datasets

> **Archived Data Notice:** The solar storm records (`public/data/storms.json`), the Artemis II path (`public/data/artemis2_trajectory.json`), the spacecraft and rocket figures (`public/data/crewed_lunar.json`) and the lunar polar targets (`public/data/moon/moon_targets.json`) bundled with the game are **archived real data**, not live feeds, so the game runs offline in any browser without API keys.

| Source | Provider | What we use it for | Link |
| --- | --- | --- | --- |
| DONKI space weather database | NASA CCMC (`api.nasa.gov`) | 5 real 2024–2025 solar storms: DONKI event IDs, start times and Kp index (`storms.json`) | [ccmc.gsfc.nasa.gov/tools/DONKI](https://ccmc.gsfc.nasa.gov/tools/DONKI/) |
| Solar proton event list | NOAA SWPC | Peak >10 MeV proton flux of those storms (`protonFluxPfu` in `storms.json`) | [swpc.noaa.gov](https://www.swpc.noaa.gov/noaa-scales-explanation) |
| Launch Services Program (LSP / VADR) | NASA Kennedy Space Center | Representative launch vehicle payload capacities (`crewed_lunar.json`) | [elvperf.ksc.nasa.gov](https://elvperf.ksc.nasa.gov/Pages/Default.aspx) |
| Orion Spacecraft Overview | NASA | Orion Crew Module mass, LAS mass, 5.0 m diameter, ECLSS consumables (`crewed_lunar.json`) | [nasa.gov/humans-in-space/orion-spacecraft](https://www.nasa.gov/humans-in-space/orion-spacecraft/) |
| Orion Radiation Protection Plan | NASA | Crew radiation storm shelter & HERA dosimetry parameters (`crewed_lunar.json`) | [nasa.gov/missions/artemis/orion/...](https://www.nasa.gov/missions/artemis/orion/scientists-and-engineers-evaluate-orion-radiation-protection-plan/) |
| Space Launch System (SLS) & Core Stage | NASA | SLS Block 1 TLI (>27 t), RS-25 thrust/Isp, 5-segment SRBs, ICPS RL10B-2 (`crewed_lunar.json`) | [nasa.gov/reference/space-launch-system-core-stage](https://www.nasa.gov/reference/space-launch-system-core-stage/) |
| European Service Module (ESM) | ESA / NASA | ESM hypergolic propellant mass, AJ10-190 engine (26.7 kN, 316 s), 11.2 kW solar wings (`crewed_lunar.json`) | [esa.int/.../European_Service_Module](https://www.esa.int/Science_Exploration/Human_and_Robotic_Exploration/Orion/European_Service_Module) |
| CGI Moon Kit (LRO LROC color map) | NASA Scientific Visualization Studio | Real lunar surface colour for the Moon in the 3D scene (`public/textures/moon_color.jpg`) | [svs.gsfc.nasa.gov/4720](https://svs.gsfc.nasa.gov/4720) |
| Falcon 9 / Falcon Heavy Specs | SpaceX | Light/Medium crewed analogs: Merlin 1D / MVac thrust, Isp, stage masses (`crewed_lunar.json`) | [spacex.com/vehicles/falcon-heavy](https://www.spacex.com/vehicles/falcon-heavy/) |
| Vulcan Centaur Overview | ULA | BE-4 first stage and Centaur V Dual-RL10C reference parameters (`crewed_lunar.json`) | [ulalaunch.com/rockets/vulcan-centaur](https://www.ulalaunch.com/rockets/vulcan-centaur) |
| Planetary fact sheets | NASA NSSDCA | Earth and Moon radius, GM and rotation period used by the flight physics | [nssdc.gsfc.nasa.gov/planetary/factsheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html) |
| LRO & LCROSS Polar Volatiles | NASA GSFC | Permanently Shadowed Region ice targets (`public/data/moon/`) | [science.nasa.gov/mission/lro](https://science.nasa.gov/mission/lro/) |
| Artemis II ephemeris | NASA JSC flight dynamics | Orion's real path on Artemis II (April 2026), from upper-stage separation to entry interface. Drawn in orange in the map view on the player's mission clock, with a "You vs Artemis II" table in the flight HUD: closest approach to the Moon (6,539 km), farthest from Earth (406,773 km) and entry time (`artemis2_trajectory.json`) | [nasa.gov/missions/artemis-ii/track-nasas-artemis-ii-mission-in-real-time](https://www.nasa.gov/missions/artemis-ii/track-nasas-artemis-ii-mission-in-real-time/) |
| Blue Marble / Black Marble | NASA Earth Observatory | 2K Earth day and night (city lights) textures on the globe (`public/textures/`) | [earthobservatory.nasa.gov](https://earthobservatory.nasa.gov/) |

### Challenge resources

How the resources listed on the [challenge page](https://www.spaceappschallenge.org/2026/challenges/space-mission-design-game/) shaped the game:

| Challenge resource | How it informs the game |
| --- | --- |
| [Design and Develop Science Missions](https://www.nasa.gov/wp-content/uploads/2025/04/250323-design-and-develop-science-mission.pdf?emrc=a454cf) (NASA) | Its mission segments map onto the game: launch segment (the rocket), space segment (the crew spacecraft) and the mission report as the review of the result. The need → concept → requirements → design → verify steps are the game loop. |
| [General Mission Analysis Tool (GMAT)](https://software.nasa.gov/software/GSC-19468-1) (NASA) | Reference for trans-lunar trajectory design. The game uses its own propagator (Earth and Moon gravity, see below), not GMAT. |
| [Concept Maturity Levels](https://dataverse.jpl.nasa.gov/dataset.xhtml?persistentId=hdl:2014/44299) (NASA JPL) | The fly → read the report → redesign loop follows CML 1–4: idea, feasibility, trade space, point design. |
| [Mission Design Lab](https://etd.gsfc.nasa.gov/capabilities/integrated-design-center/mission-design-lab/) (NASA GSFC) | The spacecraft disciplines an MDL study covers (power, structures, avionics, communications, attitude control, cost) inspired the part categories in assembly (capsule, service module, life support, power, radiation shelter). |
| [NASA Mission Viz](https://nasa.github.io/mission-viz/) | Model for showing the mission as a 3D scene with bodies, spacecraft and trajectory. |
| [A Learning Game About Telescopes](https://science.nasa.gov/mission/webb/game-build-it-yourself/) (NASA Webb) | Model for a build-it-yourself learning game where the goal constrains the parts you can choose. |
| [Visualize a Space Mission Using Virtual Reality](https://www.spaceappschallenge.org/2023/challenges/visualize-a-space-mission-using-virtual-reality/) (Space Apps 2023) | Mission concept, trajectory and timeline as the three things the flight view shows. |
| [Digital Games and Activities](https://www.asc-csa.gc.ca/eng/youth-educators/digital-games-and-activities.asp) (CSA) | Reference for explaining space concepts to younger players. |

### Science & physics calculations

The mission engine computes trade-offs using standard orbital and spacecraft engineering equations:

| Value | Formula / Method |
| --- | --- |
| Flight path | Numerical integration of Earth and Moon gravity, thrust, propellant flow from Isp and drag in an exponential atmosphere (`simulate.ts`, `orbit.ts`) |
| Orbit in the HUD | Apoapsis, periapsis and period from the state vector (vis-viva, Kepler's Third Law $T = 2\pi \sqrt{a^3 / \mu}$) |
| Launch compatibility | Spacecraft total mass $\le$ the rocket's payload to trans-lunar injection |
| Life support | Days of consumables on board vs. the days the flight actually takes |
| Solar storm dose | NOAA S-scale from the DONKI event's peak proton flux, whether the spacecraft is outside the magnetosphere, and whether the storm shelter is fitted |

### Regenerating NASA datasets (`data-prep/`)

All JSON catalogs in `public/data/` are generated and validated using Python 3 standard-library scripts in `data-prep/`, run with [uv](https://docs.astral.sh/uv/):

```bash
uv run data-prep/build_all_data.py
```

The Artemis II path is built from NASA's ephemeris file, kept in `data-prep/raw/`:

```bash
uv run data-prep/build_artemis2.py
```

To optionally refresh the archived DONKI snapshot from the live NASA endpoint (use your own free key from [api.nasa.gov](https://api.nasa.gov/); `DEMO_KEY` only allows 10 requests an hour and a DONKI refresh needs 5):

```bash
NASA_API_KEY=your_key uv run data-prep/fetch_donki.py --live
```

## Project layout

```text
data-prep/               Python scripts to build and validate NASA JSON datasets
public/
  data/                  Archived datasets the game loads: crewed_lunar (parts, rockets, engines), storms (DONKI), artemis2_trajectory
    moon/                LRO polar PSR ice targets (moon_targets.json)
  textures/              NASA Blue Marble, Black Marble and LRO Moon maps
  models/                Blender exports (.glb)
src/
  main.tsx               Entry point; loads Firebase after the game is on screen
  App.tsx                UI: parts panel, readiness gauges, mission controls
  styles.css
  firebase.ts            Firebase app setup, exports `app`
  types/
    mission.ts           Shared TypeScript contract across engine, 3D scenes, UI, and data
  core/
    crewedData.ts        Loads crewed_lunar.json through the typed contract
    design.ts            Spacecraft parts, totals and design checks (from crewed_lunar.json)
    launchCheck.ts       Rockets and whether the spacecraft fits (from crewed_lunar.json)
    orbit.ts             Constants, gravity, atmosphere, orbit elements, trajectory propagator, Sun and Moon ephemeris
    simulate.ts          Real-physics 50 Hz flight: vehicle, staging, autopilot, burn planning, life support
    orbitPlan.ts         Orbit planner: plan, prediction from the real parking orbit, checks, "Suggest a plan"
    planWorker.ts        Runs the planner's exact prediction off the main thread
    missionReport.ts     Mission report: verdict, root cause and findings for a finished flight
    artemis2.ts          NASA's Artemis II path put into the game's frame and mission clock
    spaceWeather.ts      DONKI solar storms and what they do to the crew
    vehicleData.ts       Stage and engine figures, launch abort system, ESM engine (from crewed_lunar.json)
  scenes/
    FlightScene.tsx      Continuous launch-to-Moon scene: floating origin, debris, smoke, orbit lines
    LaunchSite.tsx       Pad, service tower, buildings
    Rocket.tsx           Light / Medium / Heavy stack with the spacecraft on top
    Smoke.ts             GPU smoke particles
    ShaderMat.tsx        ShaderMaterial wrapper preserving uniforms
    SpaceScene.tsx       Earlier scripted space scene (no longer shown; mission.ts still feeds the mini-map component)
    Spacecraft.tsx       Placeholder crew spacecraft built from primitives
    Astronaut.tsx        Loads astronaut.glb if present
    Launch.tsx           3D rocket launch sequence
    mission.ts           Flight path and mission phases
    shaders/             Our own GLSL: the planet/sky shader (planet.ts), Earth, clouds, atmosphere, Moon, stars, Sun, engine plume
  audio/
    soundManager.ts      Procedural Web Audio API sound effects
  components/
    OrbitPlanner.tsx     Orbit planning step: maneuver controls, trip map, departure close-up, flight checks
    TrajectoryMap.tsx    Top-down trajectory minimap
    TutorialOverlay.tsx  Step-by-step guide for the assembly and flight screens
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

Then open http://localhost:5173. On the pad, drag to look around the rocket or spacecraft and scroll to zoom. Pick parts and a rocket on the left, check the gauges on the right, then press "Plan the orbit" to plan the trip (or "Launch with autopilot plan" to skip it) and "Launch this plan".

To check that everything compiles:

```bash
npm run build
```

Distances are real: the Moon orbits at 384,400 km.

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

## Use of AI

In accordance with NASA Space Apps Challenge 2026 guidelines:

| Area | Disclosure |
| --- | --- |
| Planning | AI assistants helped structure the task breakdown and subsystem architecture. |
| Code | AI coding assistants helped draft TypeScript types, Python data-prep scripts, and UI scaffolding; the team reviewed, validated, and tested all code. |
| Writing | AI assisted with English proofreading and educational text formatting. |
| Scientific data | Solar storm records, the Artemis II ephemeris, planetary constants, and Orion/ESM/SLS/Falcon/Vulcan engine & stage figures (`crewed_lunar.json`) come from the cited NASA, ESA, NOAA, SpaceX, and ULA sources and were verified against them. Placeholder constants in `src/core/`, and game-balance thresholds (Light/Medium TLI limits, cost caps, safe-mode hours) are documented separately as team/AI-assisted design figures. |
| Branding | No NASA logos or insignia appear in any AI-generated assets. |
