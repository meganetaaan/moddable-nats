const MESSAGE = "Node 'crypto' module is not available in the Moddable build.";

export function randomBytes(_length: number): never {
  throw new Error(MESSAGE);
}

export default { randomBytes };
