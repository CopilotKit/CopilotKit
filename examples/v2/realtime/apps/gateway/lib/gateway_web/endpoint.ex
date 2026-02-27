defmodule GatewayWeb.Endpoint do
  use Phoenix.Endpoint, otp_app: :realtime_gateway

  socket "/ws", GatewayWeb.UserSocket,
    websocket: [check_origin: false],
    longpoll: false

  plug Plug.RequestId
  plug Plug.Telemetry, event_prefix: [:phoenix, :endpoint]
  plug Plug.Parsers,
    parsers: [:json],
    pass: ["*/*"],
    json_decoder: Phoenix.json_library()
  plug Plug.MethodOverride
  plug Plug.Head

  plug :healthcheck
  plug :not_found

  defp healthcheck(%Plug.Conn{request_path: "/healthz"} = conn, _opts) do
    conn
    |> Plug.Conn.put_resp_content_type("application/json")
    |> Plug.Conn.send_resp(200, "{\"ok\":true}")
    |> Plug.Conn.halt()
  end

  defp healthcheck(conn, _opts), do: conn

  defp not_found(%Plug.Conn{state: :unset} = conn, _opts) do
    conn
    |> Plug.Conn.put_resp_content_type("application/json")
    |> Plug.Conn.send_resp(404, "{\"error\":\"not_found\"}")
    |> Plug.Conn.halt()
  end

  defp not_found(conn, _opts), do: conn
end
