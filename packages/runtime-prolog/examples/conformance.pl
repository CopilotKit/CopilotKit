:- use_module('../prolog/copilotkit_runtime').
:- use_module('../prolog/cpki_http').
:- use_module(library(http/json)).
:- initialization(main, main).

% Test-only identity adapter. Production hosts must authenticate the request.
identify(Request, _{id:ID,name:Name}) :-
    (memberchk(x_test_user_id(A),Request)->atom_string(A,ID);ID="test-user"),
    (memberchk(x_test_user_name(B),Request)->atom_string(B,Name);Name="Test User").
memory_policy(Config,_,_,Grant) :- value(Config,memoryGrant,_{user:"read-write",project:"read-write"},Grant).
main :- getenv('CPK_CONFIG',Raw),atom_json_dict(Raw,C,[]),
    Options=_{api_key:C.apiKey,api_url:C.apiUrl,runner_url:C.runnerUrl,client_url:C.clientUrl,
      identify_user:user:identify,agents:_{default:_{url:C.agentUrl,description:"Conformance agent"}}},
    (get_dict(omitMemoryPolicy,C,true)->Configured=Options;put_dict(memory_access,Options,user:memory_policy(C),Configured)),
    value(C,telemetrySampleRate,0.05,Rate),value(C,telemetryDisabled,false,Disabled),
    value(C,telemetryId,null,TelemetryId),value(C,licenseToken,null,License),
    put_dict(telemetry,Configured,_{url:C.telemetryUrl,sample_rate:Rate,disabled:Disabled,telemetry_id:TelemetryId,license_token:License},Final),
    value(C,a2ui,null,A2UI),value(C,mcpApps,_{},MCP),put_dict(_{a2ui:A2UI,mcp_apps:MCP},Final,WithUI),
    runtime_create(WithUI,R),runtime_listen(R,[port(0)],Port),
    json_write_dict(current_output,_{port:Port},[width(0)]),nl,flush_output,
    on_signal(term,_,stop_signal),on_signal(int,_,stop_signal),
    call_cleanup(thread_get_message(stop),runtime_close(R)).
stop_signal(_) :- thread_send_message(main,stop).
