:- begin_tests(hosting_contracts).
:- use_module('../prolog/copilotkit_runtime').
:- use_module('../prolog/cpki_http').
:- use_module('../prolog/cpki_telemetry').
:- use_module(library(http/http_open)).
:- use_module(library(http/http_json)).

identity(_,_{id:"user"}).
missing_identity(_,_) :- fail.
options(_{api_key:"test",identify_user:plunit_hosting_contracts:identity,telemetry:_{disabled:true}}).
test(failed_identity_is_unauthorized,[throws(error(runtime(401,_),_))]) :-
    options(O),put_dict(identify_user,O,plunit_hosting_contracts:missing_identity,C),runtime_create(C,R),
    setup_call_cleanup(true,runtime_dispatch(R,get,[threads],[],_{},[],_,_),runtime_close(R)).
test(a2ui_true_normalizes_to_default_config, [nondet]) :-
    options(O),put_dict(a2ui,O,true,C),runtime_create(C,R),
    setup_call_cleanup(true,(copilotkit_runtime:configuration(R,Config),assertion(is_dict(Config.a2ui))),runtime_close(R)).
test(disallowed_origin_gets_no_cors_header, [nondet]) :-
    options(O),put_dict(cors_origins,O,["https://trusted.test"],C),runtime_create(C,R),
    setup_call_cleanup(runtime_listen(R,[port(0)],Port),
      (format(atom(URL),'http://127.0.0.1:~d/copilotkit/missing',[Port]),
       json_request(get,URL,none,[request_header('Origin'='https://other.test'),header(access_control_allow_origin,H)],404,_),assertion(H=='')),runtime_close(R)).
test(allowed_origin_gets_cors_header, [nondet]) :-
    options(O),put_dict(cors_origins,O,["https://trusted.test"],C),runtime_create(C,R),
    setup_call_cleanup(runtime_listen(R,[port(0)],Port),
      (format(atom(URL),'http://127.0.0.1:~d/copilotkit/missing',[Port]),
       json_request(get,URL,none,[request_header('Origin'='https://trusted.test'),header(access_control_allow_origin,H)],404,_),assertion(H=='https://trusted.test')),runtime_close(R)).
test(sse_accepts_json_rpc_frame) :-
    setup_call_cleanup(open_string("data: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{}}\n\n",S),
      sse_events(S,plunit_hosting_contracts:rpc_frame),close(S)).
rpc_frame(E) :- assertion(E.id==1),assertion(E.jsonrpc=="2.0").
test(explicit_telemetry_disable_is_boolean) :-
    telemetry_create(_{disabled:true},T),
    setup_call_cleanup(true,(telemetry_disabled(T,Disabled),assertion(Disabled==true)),telemetry_close(T)).
test(path_segments_cannot_inject_routes) :-
    path([api,threads,"one/two?userId=other"],P),
    assertion(P=='/api/threads/one%2Ftwo%3FuserId=other').
test(gateway_stop_checks_topic_and_event_type) :-
    assertion(cpki_runner:stop_frame(["1","2","ingestion:run","ag-ui",_{type:"CUSTOM",name:"stop"}],"run")),
    assertion(\+cpki_runner:stop_frame(["1","2","ingestion:other","ag-ui",_{type:"CUSTOM",name:"stop"}],"run")),
    assertion(\+cpki_runner:stop_frame(["1","2","ingestion:run","ag-ui",_{type:"TEXT_MESSAGE_CONTENT",name:"stop"}],"run")).
:- end_tests(hosting_contracts).
