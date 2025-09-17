const MESSAGE = "CommonJS require is not supported in Moddable bundle.";

export function createRequire(_specifier: string) {
  return function require(_target: string): never {
    throw new Error(MESSAGE);
  };
}

export default { createRequire };
