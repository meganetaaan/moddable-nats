// Minimal nkeys implementation for Moddable
// For demo purposes - in production you would want proper Ed25519 implementation

export function createUser() {
  throw new Error("nkeys not implemented for Moddable");
}

export function createAccount() {
  throw new Error("nkeys not implemented for Moddable");
}

export function createOperator() {
  throw new Error("nkeys not implemented for Moddable");
}

export function createServer() {
  throw new Error("nkeys not implemented for Moddable");
}

export function createCluster() {
  throw new Error("nkeys not implemented for Moddable");
}

export function fromPublic() {
  throw new Error("nkeys not implemented for Moddable");
}

export function fromSeed() {
  throw new Error("nkeys not implemented for Moddable");
}

// For now, export empty object as default to prevent module errors
export default {
  createUser,
  createAccount,
  createOperator,
  createServer,
  createCluster,
  fromPublic,
  fromSeed
};