:- module(cpki_http, [json_request/6, platform/5, platform/6, value/4,
                       identifier/1, runtime_error/2, select_keys/3, path/2, query_path/3,
                       json_text/2, new_id/1, sse_events/2]).
:- use_module(library(http/http_open)).
:- use_module(library(http/http_json)).
:- use_module(library(http/json)).
:- use_module(library(http/http_ssl_plugin)).
:- use_module(library(uri)).
:- use_module(library(uuid)).
:- use_module(library(readutil)).
:- meta_predicate sse_events(+, 1).

%! value(+Dict, +Key, +Default, -Value) is det.
%  Read optional configuration without conflating false, null, and absence.
value(D, K, Default, V) :- (is_dict(D), get_dict(K, D, Found) -> V=Found; V=Default).
identifier(V) :- (string(V), normalize_space(string(S), V), S \== "", string_length(V,N), N=<512 -> true; runtime_error(400,"Valid identifier is required")).
runtime_error(Code, Message) :- throw(error(runtime(Code, Message), _)).
new_id(Id) :- uuid(A), atom_string(A, Id).
json_text(D, S) :- with_output_to(string(S), json_write_dict(current_output,D,[width(0)])).
select_keys(D, Keys, Selected) :- findall(K-V, (member(K,Keys),get_dict(K,D,V)), Pairs), dict_pairs(Selected,_,Pairs).
path(Parts, Path) :- maplist(segment,Parts,Encoded), atomic_list_concat(Encoded,'/',A), atom_concat('/',A,Path).
segment(P,E) :- uri_encoded(segment,P,E).
query_path(Base, Query, Path) :- dict_pairs(Query,_,Pairs), uri_query_components(Q,Pairs), atomic_list_concat([Base,'?',Q],Path).

%! platform(+Config, +Method, +Path, +Body, -Reply) is det.
%  Send a project-scoped native HTTP request with a bounded response.
platform(C,M,P,B,R) :- platform(C,M,P,B,[],R).
platform(C,M,P,B,Headers,R) :- atomics_to_string([C.api_url,P],URL),
    string_concat("Bearer ",C.api_key,Auth),
    json_request(M,URL,B,[request_header('Authorization'=Auth)|Headers],Status,R),
    (between(200,299,Status) -> true; runtime_error(Status,"Intelligence request failed")).

%! json_request(+Method,+URL,+Body,+Options,-Status,-Reply) is det.
%  Never follow redirects with credentials; use none for a bodyless request.
json_request(Method,URL,Body,Options,Status,Reply) :-
    (Body==none -> Post=[]; json_text(Body,Text),Post=[post(string('application/json',Text))]),
    append([method(Method),status_code(Status),timeout(10),redirect(false),
            request_header('Accept'='application/json')|Post],Options,Opts),
    setup_call_cleanup(http_open(URL,Stream,Opts),
        (read_string(Stream,4194305,Raw),string_length(Raw,N),
         (N>4194304 -> runtime_error(502,"Response exceeded size limit"); true),
         (Raw=="" -> Reply=null; catch(atom_json_dict(Raw,Reply,[]),_,runtime_error(502,"Invalid JSON response")))),
        close(Stream)).

%! sse_events(+Stream, :Emit) is det.
%  Read complete SSE frames incrementally; cap individual frames at one MiB.
sse_events(Stream, Emit) :- sse_lines(Stream,Emit,[],0).
sse_lines(S, Emit, Lines, Size) :-
    read_line_to_string(S,Line),
    (Line==end_of_file -> true
    ; Line=="" -> emit_frame(Lines,Emit),sse_lines(S,Emit,[],0)
    ; string_length(Line,N), Next is Size+N,
      (Next>1048576 -> runtime_error(502,"Agent event exceeded size limit");true),
      (sub_string(Line,0,5,_,"data:") -> sub_string(Line,5,_,0,Data), append(Lines,[Data],More);More=Lines),
      sse_lines(S,Emit,More,Next)).
emit_frame([],_) :- !.
emit_frame(Lines,Emit) :- atomics_to_string(Lines,"\n",Text), normalize_space(string(Trim),Text),
    (Trim=="[DONE]" -> true; atom_json_dict(Text,Event,[]),
     (is_dict(Event) -> call(Emit,Event);runtime_error(502,"Malformed SSE JSON object"))).
