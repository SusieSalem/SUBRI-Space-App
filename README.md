# Mission Architect

A 3D browser game built by team !subri for the NASA Space Apps Challenge 2026, "Space Mission Design Game" challenge.

## Status

Early setup. The repository currently contains the Firebase configuration and nothing else. The app itself has not been scaffolded yet.

## The game

In Mission Architect you design a space mission from start to finish and then watch it fly. You pick a mission goal, build a satellite part by part, choose an orbit on a 3D globe and pick a rocket that can get it there. The mission then runs against real NASA data, and when it ends you get a report that traces each problem back to its root cause, so you can go back and fix the design.

The first scenario is **Wildfire Watch**: put a satellite in orbit that can spot wildfires on Earth.

### How a mission goes

1. **Pick a goal.** Each scenario sets what the mission has to achieve.
2. **Build the satellite.** Add parts one at a time: structure, solar arrays, battery, antenna, computer, attitude control and instruments.
3. **Watch your resources.** Every part changes six numbers: mass, power, budget, data, communications and lifetime. Running out of any of them causes trouble later.
4. **Choose an orbit.** Low Earth orbit, sun-synchronous or geostationary, shown on a 3D globe. Each one changes coverage, revisit time, power and how often you can talk to the ground.
5. **Pick a rocket.** It has to be able to carry your satellite's mass to the orbit you chose.
6. **Run the mission.** The simulation uses real data, such as active fires from NASA FIRMS and solar storms from DONKI.
7. **Read the report and redesign.** The report doesn't just say what failed. It explains why, for example a battery too small for the eclipse periods of your orbit, or a downlink that couldn't keep up with the instrument.

The game is single player for now.

## Tech

- **React + TypeScript**, built with **Vite**
- **three.js** through **React Three Fiber** and **drei** for the 3D scenes (globe, orbits, satellite builder)
- **Recharts** for resource graphs and the mission report
- **Firebase** (project `kira-85871`), optional. It is planned for saving and sharing designs and for a leaderboard. Analytics only starts in browsers that support it, so ad blockers or private windows won't break the game.

## NASA data

These are the sources we plan to use. We will add links and exact datasets as each one is wired in.

| Source | What we use it for |
| --- | --- |
| FIRMS (Fire Information for Resource Management System) | Real active fire detections for the Wildfire Watch scenario |
| DONKI (Space Weather Database of Notifications, Knowledge, Information) | Solar storms and other space weather events during the mission |
| NASA Ames, State-of-the-Art of Small Spacecraft Technology | Realistic mass, power and performance values for satellite parts |
| MODIS / VIIRS instrument specs | Reference values for the fire-detection instruments |
| Near Space Network | Ground station coverage and data downlink |
| ODPO (Orbital Debris Program Office) | Orbital debris risk and end-of-life rules |
| Blue Marble | Earth imagery for the 3D globe |

## Project layout

```
src/
  firebase.js   Firebase app setup, exports `app`
package.json
README.md
```

Once the app is scaffolded, the entry file (for example `src/main.tsx`) should import Firebase near the top:

```ts
import "./firebase";
```

## Running it locally

You need Node.js 18 or newer.

```bash
npm install
```

There is no dev server or build script yet. The Vite commands will go here once the app is set up.

## Team

!subri
