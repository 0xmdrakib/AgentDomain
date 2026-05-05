import { getSpaceship } from './src/services/spaceship';

async function run() {
  const ss = getSpaceship();
  const res = await ss.checkAvailability('myagenttest12345.xyz');
  console.log("Standard domain:", res);
  
  const p = await ss.checkAvailability('buy.xyz');
  console.log("Taken premium:", p);
}

run();
