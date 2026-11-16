// Runs before `npm run dev` and `npm start`. Plain JS so it works on any Node version.
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(
    `\nNodeTrain needs Node.js 22.13 or newer, and this computer has ${process.version}.\n` +
      'Install the current LTS from https://nodejs.org, close this terminal, open a new one and run npm run dev again.\n',
  );
  process.exit(1);
}
