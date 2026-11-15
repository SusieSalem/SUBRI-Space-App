# Mission Architect

A 3D browser game built by team !subri for the NASA Space Apps Challenge 2026, "Space Mission Design Game" challenge.

## Status

Playable prototype in two steps, in one continuous world:

1. **Assembly.** You start on the ground at the launch pad. The whole stack stands on the pad: rocket, crew spacecraft and escape tower. Pick parts and a rocket on the left and the stack updates live. The gauges on the right say whether it is ready.
2. **Launch and flight.** The rocket flies under real physics from the pad to the Moon and back, and the camera stays with it the whole way. There are no scene changes or fades: the pad drops away, the sky darkens, the Earth curves below because the rocket is actually climbing.

Part, rocket, and engine numbers in `src/core/` are loaded from `public/data/crewed_lunar.json` (sourced NASA Orion CM, ESA European Service Module, SLS Block 1, Falcon 9 / Falcon Heavy and Vulcan Centaur figures, typed by `CrewedLunarDataset` in `src/types/mission.ts`). With them, the flight simulation flies the dataset's reference designs end to end: `crewed_flyby` on Medium and `crewed_min_orbit` / `crewed_full_artemis` on Heavy reach the Moon and splash down; Light reaches orbit but cannot send the capsule to the Moon.

### How the flight works

The physics live in `src/core/` and have no rendering code in them:

- Gravity from the Earth and the Moon (the Moon moves on its orbit), thrust and propellant use per stage with sea-level and vacuum Isp, drag in an exponential atmosphere that turns with the Earth, and automatic staging when a stage runs dry. Dropped stages keep falling under gravity and drag.
- An autopilot flies the mission like a real one: vertical rise, gravity turn, closed-loop guidance into a ~185 km parking orbit, a trans-lunar injection burn at the moment that sends the spacecraft round the Moon, two course corrections for a free return, service module separation, a lifting re-entry and parachutes.
- You can take over at any time (`WASD` to steer, `Shift`/`Ctrl` throttle, `Z` full, `X` cut, `T` to give control back to the autopilot).
- Time warp (`Auto`, or `1x` to `100,000x`), limited to `4x` while engines run or inside the atmosphere. Map view (`M`) shows the predicted path and the Moon's orbit.
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
- One planet shader at real scale (`src/scenes/shaders/planet.ts`) draws the Earth, its atmosphere, clouds, the coast at the launch site, the Moon, the Sun and the stars from wherever the camera is, from 2 m above the pad to lunar distance. The world is re-centred on the spacecraft every frame and uses a logarithmic depth buffer, so real distances work without precision problems. There is a `High` / `Low` quality switch for slower machines.

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

## NASA data & archived datasets

> **Archived Data Notice:** The wildfire hotspots (`public/data/fires.json`), solar storm records (`public/data/storms.json`), and lunar polar target coordinates (`public/data/moon/moon_targets.json`) bundled with the game are **archived real NASA datasets**, not live streaming feeds, so the game runs reliably offline in any browser without runtime API keys.

| Source | Provider | What we use it for | Link |
| --- | --- | --- | --- |
| FIRMS active fire data | NASA Earthdata / LANCE | 24 real VIIRS/MODIS fire detections from the public FIRMS country-year archive: location, brightness temperature, FRP, date, satellite (`fires.json`; each record links the archive file it was copied from) | [firms.modaps.eosdis.nasa.gov](https://firms.modaps.eosdis.nasa.gov/) |
| DONKI space weather database | NASA CCMC (`api.nasa.gov`) | 5 real 2024–2025 solar storms: DONKI event IDs, start times and Kp index (`storms.json`) | [ccmc.gsfc.nasa.gov/tools/DONKI](https://ccmc.gsfc.nasa.gov/tools/DONKI/) |
| Solar proton event list | NOAA SWPC | Peak >10 MeV proton flux of those storms (`protonFluxPfu` in `storms.json`) | [swpc.noaa.gov](https://www.swpc.noaa.gov/noaa-scales-explanation) |
| State-of-the-Art of Small Spacecraft Technology | NASA Ames Research Center | Reference ranges for the mass, power, cost, and data rates of spacecraft subsystems (`parts.json`; values are representative and game-balanced) | [nasa.gov/smallsat-institute/sst-soa](https://www.nasa.gov/smallsat-institute/sst-soa/) |
| MODIS and VIIRS instrument specs | NASA Earth Observing System | Thermal infrared camera resolution baselines (375 m VIIRS, 1 km MODIS) | [earthdata.nasa.gov/data/tools/firms/faq](https://www.earthdata.nasa.gov/data/tools/firms/faq) |
| Near Space Network & Deep Space Network | NASA SCaN | Real ground station sites and supported bands (`stations.json`); elevation masks and per-pass capacities are game-balanced | [nasa.gov/technology/space-comms/near-space-network-complexes](https://www.nasa.gov/technology/space-comms/near-space-network-complexes/) |
| Launch Services Program (LSP / VADR) | NASA Kennedy Space Center | Representative launch vehicle mass-to-orbit capacities (`rockets.json`, `crewed_lunar.json`) | [elvperf.ksc.nasa.gov](https://elvperf.ksc.nasa.gov/Pages/Default.aspx) |
| Orbital Debris Program Office (ODPO) | NASA Johnson Space Center | Background and orbital drag / debris avoidance mechanics | [orbitaldebris.jsc.nasa.gov](https://orbitaldebris.jsc.nasa.gov/) |
| Orion Spacecraft Overview | NASA | Orion Crew Module mass, LAS mass, 5.0 m diameter, ECLSS consumables (`crewed_lunar.json`) | [nasa.gov/humans-in-space/orion-spacecraft](https://www.nasa.gov/humans-in-space/orion-spacecraft/) |
| Orion Radiation Protection Plan | NASA | Crew radiation storm shelter & HERA dosimetry parameters (`crewed_lunar.json`) | [nasa.gov/missions/artemis/orion/...](https://www.nasa.gov/missions/artemis/orion/scientists-and-engineers-evaluate-orion-radiation-protection-plan/) |
| Space Launch System (SLS) & Core Stage | NASA | SLS Block 1 TLI (>27 t), RS-25 thrust/Isp, 5-segment SRBs, ICPS RL10B-2 (`crewed_lunar.json`) | [nasa.gov/reference/space-launch-system-core-stage](https://www.nasa.gov/reference/space-launch-system-core-stage/) |
| European Service Module (ESM) | ESA / NASA | ESM hypergolic propellant mass, AJ10-190 engine (26.7 kN, 316 s), 11.2 kW solar wings (`crewed_lunar.json`) | [esa.int/.../European_Service_Module](https://www.esa.int/Science_Exploration/Human_and_Robotic_Exploration/Orion/European_Service_Module) |
| Falcon 9 / Falcon Heavy Specs | SpaceX | Light/Medium crewed analogs: Merlin 1D / MVac thrust, Isp, stage masses (`crewed_lunar.json`) | [spacex.com/vehicles/falcon-heavy](https://www.spacex.com/vehicles/falcon-heavy/) |
| Vulcan Centaur Overview | ULA | BE-4 first stage and Centaur V Dual-RL10C reference parameters (`crewed_lunar.json`) | [ulalaunch.com/rockets/vulcan-centaur](https://www.ulalaunch.com/rockets/vulcan-centaur) |
| Planetary fact sheets | NASA NSSDCA | Earth and Moon radius, GM and rotation period used by the orbit formulas | [nssdc.gsfc.nasa.gov/planetary/factsheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html) |
| LRO & LCROSS Polar Volatiles | NASA GSFC | Permanently Shadowed Region ice targets (`public/data/moon/`) | [science.nasa.gov/mission/lro](https://science.nasa.gov/mission/lro/) |
| Artemis II ephemeris | NASA JSC flight dynamics | Orion's real path on Artemis II (April 2026), from upper-stage separation to entry interface. Drawn in orange in the map view on the player's mission clock, with a "You vs Artemis II" table in the flight HUD: closest approach to the Moon (6,539 km), farthest from Earth (406,773 km) and entry time (`artemis2_trajectory.json`) | [nasa.gov/missions/artemis-ii/track-nasas-artemis-ii-mission-in-real-time](https://www.nasa.gov/missions/artemis-ii/track-nasas-artemis-ii-mission-in-real-time/) |
| Blue Marble / Black Marble | NASA Earth Observatory | Earth day and night imagery references for the globe | [earthobservatory.nasa.gov](https://earthobservatory.nasa.gov/) |

### Challenge resources

How the resources listed on the [challenge page](https://www.spaceappschallenge.org/2026/challenges/space-mission-design-game/) shaped the game:

| Challenge resource | How it informs the game |
| --- | --- |
| [Design and Develop Science Missions](https://www.nasa.gov/wp-content/uploads/2025/04/250323-design-and-develop-science-mission.pdf?emrc=a454cf) (NASA) | Its four mission segments are the four things the player designs: launch segment (rocket), space segment (spacecraft and instruments), ground segment (stations and mission control), user segment (science return in the report). The need → concept → requirements → design → verify steps are the game loop. |
| [General Mission Analysis Tool (GMAT)](https://software.nasa.gov/software/GSC-19468-1) (NASA) | Reference for the orbit regimes we offer (LEO, SSO, GEO, lunar). The game uses the simplified two-body formulas below, not GMAT propagation. |
| [Concept Maturity Levels](https://dataverse.jpl.nasa.gov/dataset.xhtml?persistentId=hdl:2014/44299) (NASA JPL) | The fly → read the report → redesign loop follows CML 1–4: idea, feasibility, trade space, point design. |
| [Mission Design Lab](https://etd.gsfc.nasa.gov/capabilities/integrated-design-center/mission-design-lab/) (NASA GSFC) | The spacecraft disciplines an MDL study covers (power, structures, avionics, communications, attitude control, cost) are the subsystem categories in the workshop. |
| [NASA Mission Viz](https://nasa.github.io/mission-viz/) | Model for showing the mission as a 3D scene with bodies, spacecraft and trajectory. |
| [A Learning Game About Telescopes](https://science.nasa.gov/mission/webb/game-build-it-yourself/) (NASA Webb) | Model for letting the science objective constrain the instrument choices, with levels of increasing difficulty. |
| [CubeSat 101](https://www3.nasa.gov/sites/default/files/atoms/files/nasa_csli_cubesat_101_508.pdf) (NASA CSLI) | Small-satellite classes and the rideshare launch model behind the Rideshare rocket option. |
| [Visualize a Space Mission Using Virtual Reality](https://www.spaceappschallenge.org/2023/challenges/visualize-a-space-mission-using-virtual-reality/) (Space Apps 2023) | Mission concept, trajectory and timeline as the three things the flight view shows. |
| [Digital Games and Activities](https://www.asc-csa.gc.ca/eng/youth-educators/digital-games-and-activities.asp) (CSA) | Reference for explaining space concepts to younger players. |

### Science & physics calculations

The mission engine computes trade-offs using standard orbital and spacecraft engineering equations:

| Value | Formula / Method |
| --- | --- |
| Orbital period | Kepler's Third Law: $T = 2\pi \sqrt{a^3 / \mu}$ where $a = R_{\text{body}} + h$ |
| Time in shadow (eclipse) | Cylindrical shadow geometry: $t_{\text{eclipse}} = T \cdot \frac{\arcsin(R_{\text{body}} / a)}{\pi}$ |
| Ground resolution (GSD) | Altitude $\times$ instrument angular resolution: $\text{GSD} = h \cdot \theta$ |
| Link budget & memory buffer | Net storage delta = $(\text{Data}_{\text{generated}} - \text{Downlink}_{\text{pass}}) \times \Delta t$ over NASA SCaN ground station passes |
| Launch compatibility | Spacecraft total mass $\le$ launcher payload limit for the chosen orbit (`LEO`, `SSO`, `GEO`, `Lunar Polar`) |

### Regenerating NASA datasets (`data-prep/`)

All JSON catalogs in `public/data/` are generated and validated using Python 3 standard-library scripts in `data-prep/`, run with [uv](https://docs.astral.sh/uv/):

```bash
uv run data-prep/build_all_data.py
```

The Artemis II path is built from NASA's ephemeris file, kept in `data-prep/raw/`:

```bash
uv run data-prep/build_artemis2.py
```

To optionally refresh the archived FIRMS or DONKI snapshots from live NASA endpoints (use your own free key from [api.nasa.gov](https://api.nasa.gov/); `DEMO_KEY` only allows 10 requests an hour and a DONKI refresh needs 5):

```bash
FIRMS_MAP_KEY=your_key uv run data-prep/fetch_firms.py --live
NASA_API_KEY=your_key uv run data-prep/fetch_donki.py --live
```

## Project layout

```text
data-prep/               Python scripts to build and validate NASA JSON datasets
public/
  data/                  Archived NASA datasets (parts, rockets, stations, fires, storms, orbits, scenarios, explanations)
    moon/                Lunar Ice Hunter constants, orbits, and LRO polar PSR targets
  models/                Blender exports (.glb)
src/
  main.tsx               Entry point, imports Firebase
  App.tsx                UI: parts panel, readiness gauges, mission controls
  styles.css
  firebase.ts            Firebase app setup, exports `app`
  types/
    mission.ts           Shared TypeScript contract across engine, 3D scenes, UI, and data
  core/
    crewedData.ts        Loads crewed_lunar.json through the typed contract
    design.ts            Spacecraft parts, totals and design checks (from crewed_lunar.json)
    launchCheck.ts       Rockets and whether the spacecraft fits (from crewed_lunar.json)
    orbit.ts             Constants, gravity, atmosphere, orbit elements, trajectory propagator
    simulate.ts          Real-physics 50 Hz flight: vehicle, staging, autopilot, burn planning
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
    TrajectoryMap.tsx    Top-down trajectory minimap
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

Then open http://localhost:5173. On the pad, drag to look around the rocket or spacecraft and scroll to zoom. Pick parts and a rocket on the left, check the gauges on the right, and press Launch.

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

## Use of AI

In accordance with NASA Space Apps Challenge 2026 guidelines:

| Area | Disclosure |
| --- | --- |
| Planning | AI assistants helped structure the task breakdown and subsystem architecture. |
| Code | AI coding assistants helped draft TypeScript types, Python data-prep scripts, and UI scaffolding; the team reviewed, validated, and tested all code. |
| Writing | AI assisted with English proofreading and educational text formatting. |
| Scientific data | Wildfire detections, solar storm records, planetary constants, and Orion/ESM/SLS/Falcon/Vulcan engine & stage figures (`crewed_lunar.json`) come from the cited NASA, ESA, NOAA, SpaceX, and ULA sources and were verified against them; ground station sites and bands follow NASA's Near Space Network list. Representative satellite bus parts (`parts.json`), placeholder constants in `src/core/`, and game-balance thresholds (Light/Medium TLI limits, cost caps, science values, safe-mode hours, per-pass capacity) are documented separately as team/AI-assisted design figures. |
| Branding | No NASA logos or insignia appear in any AI-generated assets. |
