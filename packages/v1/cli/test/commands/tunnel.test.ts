// Add at the top with other imports
declare global {
  interface Process {
    emit(event: "mockExit", code?: number): boolean;
    once(event: "mockExit", listener: (code?: number) => void): Process;
  }
}

import { expect } from "chai";
import { EventEmitter } from "node:events";
import sinon from "sinon";
import sinonChai from "sinon-chai";
import chai from "chai";
import { Config } from "@oclif/core";
import TunnelCreate from "../../src/commands/tunnel";
import { TunnelService } from "../../src/services/tunnel.service";
import { Tunnel } from "localtunnel";

chai.use(sinonChai);

class MockTunnel extends EventEmitter {
  close = sinon.stub().resolves();
  open = sinon.stub().resolves();
  url = "https://test-subdomain.test-tunnel-host.com";
}

describe("tunnel", () => {
  let mockTunnel: MockTunnel;
  let tunnelService: TunnelService;
  let config: Config;
  let originalExit: (code?: number) => never;

  beforeEach(async () => {
    sinon.restore();
    mockTunnel = new MockTunnel();
    tunnelService = new TunnelService();
    config = await Config.load();

    // Stub TunnelService methods
    sinon
      .stub(tunnelService, "getMetaData")
      .resolves({ tunnelHost: "test-tunnel-host.com" });
    sinon
      .stub(tunnelService, "create")
      .resolves(mockTunnel as unknown as Tunnel);

    // Store original process.exit
    originalExit = process.exit;
    // Stub process.exit to prevent test exit
    sinon.stub(process, "exit").callsFake((code?: number) => {
      // Instead of exiting, emit a custom event that we can listen for
      // @ts-expect-error
      process.emit("mockExit", code);
      return undefined as never;
    });
  });

  afterEach(() => {
    sinon.restore();
    // Restore original exit
    process.exit = originalExit;
  });

  it("creates a tunnel with required port argument", (done) => {
    const command = new TunnelCreate(["3000"], config, tunnelService);

    // Listen for our custom mockExit event
    process.once("mockExit", () => {
      try {
        // Verify the tunnel was created with correct options
        expect(tunnelService.create).to.have.been.calledWith({
          host: "test-tunnel-host.com",
          port: 3000,
          subdomain: undefined,
        });
        done();
      } catch (error) {
        done(error);
      }
    });

    // Run the command and then emit close after a short delay
    command.run().catch(done);
    setTimeout(() => mockTunnel.emit("close"), 100);
  });

  it("fails without port argument", (done) => {
    const command = new TunnelCreate([], config, tunnelService);

    command.run().catch((error) => {
      try {
        expect(error.message).to.include("Missing 1 required arg");
        expect(error.message).to.include("port");
        done();
      } catch (error) {
        done(error);
      }
    });
  });

  it("creates tunnel with subdomain flag", (done) => {
    const command = new TunnelCreate(
      ["3000", "--subdomain", "test-subdomain"],
      config,
      tunnelService,
    );

    process.once("mockExit", () => {
      try {
        expect(tunnelService.create).to.have.been.calledWith({
          host: "test-tunnel-host.com",
          port: 3000,
          subdomain: "test-subdomain",
        });
        done();
      } catch (error) {
        done(error);
      }
    });

    command.run().catch(done);
    setTimeout(() => mockTunnel.emit("close"), 100);
  });

  it("handles SIGINT signal", (done) => {
    const command = new TunnelCreate(["3000"], config, tunnelService);

    process.once("mockExit", () => {
      try {
        expect(mockTunnel.close).to.have.been.called;
        done();
      } catch (error) {
        done(error);
      }
    });

    command.run().catch(done);
    setTimeout(() => {
      process.emit("SIGINT");
      // Need to emit close after SIGINT to complete the test
      setTimeout(() => mockTunnel.emit("close"), 100);
    }, 100);
  });
});
