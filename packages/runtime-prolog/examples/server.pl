:- use_module(library(copilotkit_runtime)).
:- use_module(library(uuid)).
:- initialization(main, main).

%! identify(+Request,-User) is semidet.
%  Single-user demo authentication. A deployed host supplies its session lookup.
identify(Request, _{id:ID}) :-
    memberchk(authorization(Header),Request),atom_concat('Bearer ',Token,Header),
    getenv('DEMO_AUTH_TOKEN',Token),Token\=='',
    getenv('DEMO_USER_ID',User),User\=='',atom_string(User,ID).

%! local_agent(+Input,:Emit) is det.
%  A native Prolog agent emits AG-UI dicts through the runtime callback.
local_agent(Input,Emit) :-
    uuid(UUID),atom_string(UUID,MessageId),
    call(Emit,_{type:"RUN_STARTED",threadId:Input.threadId,runId:Input.runId}),
    call(Emit,_{type:"TEXT_MESSAGE_START",messageId:MessageId,role:"assistant"}),
    call(Emit,_{type:"TEXT_MESSAGE_CONTENT",messageId:MessageId,delta:"Hello from Prolog."}),
    call(Emit,_{type:"TEXT_MESSAGE_END",messageId:MessageId}),
    call(Emit,_{type:"RUN_FINISHED",threadId:Input.threadId,runId:Input.runId}).

%! main is det.
%  Start the server and drain active runs when the process receives SIGTERM.
main :-
    getenv('CPK_INTELLIGENCE_API_KEY',KeyAtom),atom_string(KeyAtom,Key),
    runtime_create(_{api_key:Key,identify_user:user:identify,
      agents:_{default:_{run:user:local_agent,description:"Native Prolog agent"}}},Runtime),
    setup_call_cleanup(runtime_listen(Runtime,[port(4000)],_),
      (on_signal(term,_,stop_signal),on_signal(int,_,stop_signal),thread_get_message(stop)),
      runtime_close(Runtime)).
stop_signal(_) :- thread_send_message(main,stop).
