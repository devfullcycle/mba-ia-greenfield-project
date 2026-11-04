declare module '@ffprobe-installer/ffprobe' {
  const ffprobe: {
    path: string;
    version?: string;
    url?: string;
  };
  export = ffprobe;
}
