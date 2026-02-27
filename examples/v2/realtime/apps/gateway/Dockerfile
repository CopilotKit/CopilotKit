FROM hexpm/elixir:1.17.3-erlang-27.2.2-debian-bookworm-20250203

WORKDIR /app

RUN mix local.hex --force && mix local.rebar --force

COPY examples/v2/realtime/apps/gateway ./

ENV MIX_ENV=prod

RUN mix deps.get --only ${MIX_ENV}
RUN mix deps.compile
RUN mix compile

EXPOSE 4200
CMD ["mix", "phx.server"]
