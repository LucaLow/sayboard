interface EspeakModule {
  ccall(name: 'init', returnType: 'number', argTypes: [], args: []): number;
  ccall(name: 'version', returnType: 'string', argTypes: [], args: []): string;
  ccall(name: 'phonemize', returnType: 'string', argTypes: ['string', 'string'], args: [string, string]): string | null;
}
export default function create(options: { locateFile: (file: string) => string }): Promise<EspeakModule>;
