:- module(cpki_telemetry,[telemetry_create/2,telemetry_emit/3,telemetry_close/1,telemetry_disabled/2]).
:- use_module(cpki_http).
:- use_module(library(base64)).
:- use_module(library(http/json)).
:- use_module(library(pcre)).
:- use_module(library(time)).
:- dynamic exporter/4.

%! telemetry_create(+Options,-Telemetry) is det.
%  Create a bounded native exporter. Analytics identity grants no runtime access.
telemetry_create(Options,ID) :-
    new_id(ID),settings(Options,Settings),message_queue_create(Q,[max_size(256)]),
    thread_create(export_loop(Q,Settings),Thread,[]),assertz(exporter(ID,Settings,Q,Thread)).
settings(O,S) :-
    (get_dict(disabled,O,true);env_true('DO_NOT_TRACK');env_true('COPILOTKIT_TELEMETRY_DISABLED')->Disabled=true;Disabled=false),
    value(O,sample_rate,0.05,Configured),
    (getenv('COPILOTKIT_TELEMETRY_SAMPLE_RATE',Raw),catch(atom_number(Raw,Env),_,fail)->Rate0=Env;Rate0=Configured),
    (number(Rate0),Rate0>=0,Rate0=<1->Rate1=Rate0;Rate1=0.05),
    (Disabled==true->Identity=none,Identified=false,Rate=Rate1
    ;standalone_id(O,Identity)->Identified=false,Rate=Rate1
    ;license_id(O,Identity)->Identified=true,Rate=1
    ;Identity=none,Identified=false,Rate=Rate1),
    (get_dict(url,O,URL)->true;getenv('COPILOTKIT_TELEMETRY_URL',URL)->true;URL="https://telemetry.copilotkit.ai/ingest"),
    S=_{disabled:Disabled,rate:Rate,identity:Identity,identified:Identified,url:URL}.
env_true(Key) :- getenv(Key,Raw),downcase_atom(Raw,Value),memberchk(Value,[true,'1']).
standalone_id(O,ID) :- (get_dict(telemetry_id,O,Raw);getenv('CPK_TELEMETRY_ID',A),atom_string(A,Raw)),valid_id(Raw,ID),!.
valid_id(Raw,ID) :- string(Raw),re_replace('^[ \t]+|[ \t]+$'/g,"",Raw,ID),re_match('^[A-Za-z0-9_-]{1,128}$',ID).
license_id(O,ID) :-
    (get_dict(license_token,O,Explicit),string(Explicit),\+blank_token(Explicit)->Token=Explicit
    ;getenv('COPILOTKIT_LICENSE_TOKEN',A),atom_string(A,Token)),
    split_string(Token,".","",[_,Payload,_]),re_match('^[A-Za-z0-9_-]+$',Payload),
    catch((base64_encoded(Decoded,Payload,[as(string),charset(url),padding(false)]),atom_json_dict(Decoded,Claims,[]),valid_id(Claims.telemetry_id,ID)),_,fail).
blank_token(Token) :- re_match('^[\\x{0009}-\\x{000D}\\x{0020}\\x{00A0}\\x{1680}\\x{2000}-\\x{200A}\\x{2028}\\x{2029}\\x{202F}\\x{205F}\\x{3000}\\x{FEFF}]*$',Token).
telemetry_disabled(ID,Disabled) :- exporter(ID,S,_,_),Disabled=S.disabled.

%! telemetry_emit(+Telemetry,+Event,+Attributes) is det.
%  Construct allowlisted properties without copying application input or errors.
telemetry_emit(ID,Name,Attributes) :-
    catch((exporter(ID,S,Q,_),S.disabled==false,S.rate>0,
      (S.identified==true;random_float<S.rate),properties(Name,Attributes,Properties),
      string_concat("oss.runtime.",Name,Event),get_time(Now),TS is floor(Now),
      Adjustment is 1-S.rate,Weight is 1/S.rate,
      Payload=_{event:Event,properties:Properties,ts:TS,
        package:_{name:"copilotkit-runtime-prolog",version:"0.1.0"},
        global_properties:_{sampleRate:S.rate,sampleRateAdjustmentFactor:Adjustment,sampleWeight:Weight,
          telemetry_identified:S.identified,telemetry_emitter:"runtime-prolog",telemetry_transport:"lambda"}},
      thread_send_message(Q,Payload,[timeout(0)])),_,true),!.
telemetry_emit(_,_,_).
properties("instance_created",A,_{actionsAmount:0,endpointTypes:[],endpointsAmount:0,agentsAmount:N,'cloud.api_key_provided':false}) :- value(A,agentsAmount,0,N).
properties("copilot_request_created",A,_{requestType:T,'cloud.guardrails.enabled':false,'cloud.api_key_provided':false}) :- T=A.requestType,memberchk(T,["run","connect"]).
properties("agent_execution_stream_started",_,_{}).
properties("agent_execution_stream_ended",_,_{}).
properties("agent_execution_stream_errored",_,_{error:"AGENT_RUN_FAILED"}).
export_loop(Q,S) :- thread_get_message(Q,Event),
    (Event==stop->true;
     (S.identity==none->Headers=[];Headers=[request_header('X-CopilotKit-Telemetry-Id'=S.identity)]),
     catch(call_with_time_limit(3,json_request(post,S.url,Event,Headers,_,_)),_,true),export_loop(Q,S)).

%! telemetry_close(+Telemetry) is det.
%  Drain within three seconds, then interrupt a stalled exporter.
telemetry_close(ID) :-
    (retract(exporter(ID,_,Q,T))->
      catch(call_with_time_limit(3,(thread_send_message(Q,stop),thread_join(T,_))),_,
        (catch(thread_signal(T,throw(telemetry_closed)),_,true),catch(thread_join(T,_),_,true))),
      message_queue_destroy(Q);true).
