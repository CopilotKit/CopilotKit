defmodule Gateway.TokenStore do
  @moduledoc false

  def consume_token(token) when is_binary(token) do
    case Redix.command(Gateway.Redix, ["GETDEL", token_key(token)]) do
      {:ok, nil} -> {:error, :token_expired_or_used}
      {:ok, payload} -> decode(payload)
      {:error, reason} -> {:error, reason}
    end
  end

  def token_replay(token) when is_binary(token) do
    case Redix.command(Gateway.Redix, ["GET", token_replay_key(token)]) do
      {:ok, nil} -> []
      {:ok, payload} ->
        case Jason.decode(payload) do
          {:ok, events} when is_list(events) -> events
          _ -> []
        end

      {:error, _reason} -> []
    end
  end

  defp decode(payload) do
    case Jason.decode(payload) do
      {:ok, %{"threadId" => thread_id} = metadata} when is_binary(thread_id) ->
        {:ok,
         %{
           thread_id: thread_id,
           agent_id: metadata["agentId"],
           issued_at: metadata["issuedAt"]
         }}

      _ ->
        {:error, :invalid_token_payload}
    end
  end

  defp token_key(token), do: "ck:token:" <> token
  defp token_replay_key(token), do: "ck:token-replay:" <> token
end
