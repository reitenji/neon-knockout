export type RuntimeNetworkAddress = Readonly<{
  interfaceName: string;
  address: string;
  url: string;
}>;

export type RuntimeNetworkInfo = Readonly<{
  port: number;
  localUrl: string;
  lanAddresses: readonly RuntimeNetworkAddress[];
}>;
