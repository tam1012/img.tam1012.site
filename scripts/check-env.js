function requireEnv(name, minLength = 1) {
  const value = process.env[name];
  if (!value || value.length < minLength) {
    throw new Error(`${name} phải có tối thiểu ${minLength} ký tự`);
  }
}

requireEnv("SESSION_SECRET", 32);
requireEnv("ADMIN_EMAIL", 3);
requireEnv("ADMIN_PASSWORD", 8);
requireEnv("DATABASE_URL", 10);

console.log("Environment OK");
