:- begin_tests(runtime_contracts).
:- use_module('../prolog/copilotkit_runtime').

test(identifier_rejects_blank, [throws(error(runtime(400, _), _))]) :-
    copilotkit_runtime:identifier(" ").
test(identifier_rejects_non_string, [throws(error(runtime(400, _), _))]) :-
    copilotkit_runtime:identifier(42).
test(identity_required, [throws(error(runtime(401, _), _))]) :-
    runtime_create(_{api_key:"test", identify_user:plunit_runtime_contracts:anonymous}, R),
    setup_call_cleanup(true, runtime_dispatch(R, get, [threads], [], _{}, [], _, _), runtime_close(R)).
test(invalid_run_has_no_network, [throws(error(runtime(400, _), _))]) :-
    runtime_create(_{api_key:"test", identify_user:plunit_runtime_contracts:identity,
                     agents:_{default:_{url:"http://127.0.0.1:1"}}}, R),
    setup_call_cleanup(true,
        runtime_dispatch(R, post, [agent,default,run], [], _{threadId:"t",runId:"r",messages:42}, [], _, _),
        runtime_close(R)).
anonymous(_, null).
identity(_, _{id:"user"}).
:- end_tests(runtime_contracts).
:- ensure_loaded('ui_tests.pl').
:- ensure_loaded('hosting_tests.pl').
:- initialization((run_tests -> halt(0); halt(1)), main).
