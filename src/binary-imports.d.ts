// `file?b64` imports are turned into a base64 string by the inlineBinary
// plugin in vite.config.ts.
declare module '*?b64' {
  const base64: string;
  export default base64;
}
