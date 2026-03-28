import type { Tunnel } from "localtunnel";

import axios from "axios";
import localtunnel from "localtunnel";

export interface TunnelOptions {
  port: number;
  subdomain?: string;
}

export class TunnelService {
  private readonly META_DATA_URL =
    "https://metadata-cdn.copilotkit.ai/cloud.config.json";

  async create(options: TunnelOptions): Promise<Tunnel> {
    const metadata = await this.getMetaData();

    return localtunnel({
      ...options,
      host: metadata.tunnelHost,
    });
  }

  async getMetaData() {
    const response = await axios.get<{
      tunnelHost: string;
    }>(this.META_DATA_URL);
    return response.data;
  }
}
