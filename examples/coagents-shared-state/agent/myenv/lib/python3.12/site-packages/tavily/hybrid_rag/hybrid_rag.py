import os
from typing import Union, Optional, Literal

from tavily import TavilyClient

try:
    import cohere
    co = cohere.Client()
except:
    co = None

def _validate_index(client):
    """
    Check that the index specified by the parameters exists and is a valid vector search index.

    Raises:
        ValueError: If the index does not exist, is not of type 'vectorSearch', or if the embeddings field
                    does not exist, is not of type 'vector', or has similarity other than 'cosine'.
    """
    index_exists = False
    for index in client.collection.list_search_indexes():
        if index['name'] != client.index:
            continue
        
        if index['type'] != 'vectorSearch':
            raise ValueError(f"Index '{client.index}' exists but is not of type "
                             "'vectorSearch'.")
        
        field_exists = False
        for field in index['latestDefinition']['fields']:
            if field['path'] != client.embeddings_field:
                continue
            
            if field['type'] != 'vector':
                raise ValueError(f"Field '{client.embeddings_field}' exists "
                                 "but is not of type 'vector'.")
            elif field['similarity'] != 'cosine':
                raise ValueError(f"Field '{client.embeddings_field}' exists but has "
                                 f"similarity '{field['similarity']}' instead of 'cosine'.")
            
            field_exists = True
            break
        
        if not field_exists:
            raise ValueError(f"Field '{client.embeddings_field}' does not exist in "
                             "index '{client.index}'.")
        
        index_exists = True
        
    if not index_exists:
        raise ValueError(f"Index '{client.index}' does not exist.")

def _cohere_embed(texts, type):
    return co.embed(
        model='embed-english-v3.0',
        texts=texts,
        input_type=type
    ).embeddings

def _cohere_rerank(query, documents, top_n):
    response = co.rerank(model='rerank-english-v3.0', query=query,
                         documents=[doc['content'] for doc in documents], top_n=top_n)
    
    return [
        documents[result.index] | {'score': result.relevance_score}
        for result in response.results
    ]

class TavilyHybridClient():
    def __init__(
            self,
            api_key: Union[str, None],
            db_provider: Literal['mongodb'],
            collection,
            index: str,
            embeddings_field: str = 'embeddings',
            content_field: str = 'content',
            embedding_function: Optional[callable] = None,
            ranking_function: Optional[callable] = None
        ):
        '''
        A client for performing hybrid RAG using both the Tavily API and a local database collection.
        
        Parameters:
        api_key (str): The Tavily API key. If this is set to None, it will be loaded from the environment variable TAVILY_API_KEY.
        db_provider (str): The database provider. Currently only 'mongodb' is supported.
        collection (str): The name of the collection in the database that will be used for local search.
        index (str): The name of the collection's vector search index.
        embeddings_field (str): The name of the field in the collection that contains the embeddings.
        content_field (str): The name of the field in the collection that contains the content.
        embedding_function (callable): If provided, this function will be used to generate embeddings for the search query and documents.
        ranking_function (callable): If provided, this function will be used to rerank the combined results.
        '''
        
        self.tavily = TavilyClient(api_key)
        
        if db_provider != 'mongodb':
            raise ValueError("Only MongoDB is currently supported as a database provider.")
        
        self.collection = collection
        self.index = index
        self.embeddings_field = embeddings_field
        self.content_field = content_field
        
        self.embedding_function = _cohere_embed if embedding_function is None else embedding_function
        self.ranking_function = _cohere_rerank if ranking_function is None else ranking_function
        
        _validate_index(self)

    def search(self, query, max_results=10, max_local=None, max_foreign=None,
               save_foreign=False, **kwargs):
        '''
        Return results for the given query from both the tavily API (foreign) and
        the specified mongo collection (local).
        
        Parameters:
        query (str): The query to search for.
        max_results (int): The maximum number of results to return.
        max_local (int): The maximum number of local results to return.
        max_foreign (int): The maximum number of foreign results to return.
        save_foreign (bool or function): Whether to save the foreign results in the collection.
            If a function is provided, it will be used to transform the foreign results before saving.
        '''

        if max_local is None:
            max_local = max_results
        
        if max_foreign is None:
            max_foreign = max_results

        query_embeddings = self.embedding_function([query], 'search_query')[0]

        # Search the local collection
        local_results = list(self.collection.aggregate([
            {
                "$vectorSearch": {
                    "index": self.index,
                    "path": self.embeddings_field,
                    "queryVector": query_embeddings,
                    "numCandidates": max_local + 3,
                    "limit": max_local
                }
            },
            {
                "$project": {
                    "_id": 0,
                    "content": f"${self.content_field}",
                    "score": {
                        "$meta": "vectorSearchScore"
                    },
                    "origin": "local"
                }
            }
        ]))

        # Search using tavily
        if max_foreign > 0:
            foreign_results = self.tavily.search(query, max_results=max_foreign, **kwargs)['results']
        else:
            foreign_results = []

        # Combine the results
        projected_foreign_results = [
            {
                'content': result['content'],
                'score': result['score'],
                'origin': 'foreign'
            }
            for result in foreign_results
        ]
        
        combined_results = local_results + projected_foreign_results
        
        if len(combined_results) == 0:
            return []

        # Sort the combined results
        combined_results = self.ranking_function(query, combined_results, max_results)

        if len(combined_results) > max_results:
            combined_results = combined_results[:max_results]

        # Can't use 'not save_foreign' because save_foreign is not necessarily a boolean
        if max_foreign > 0 and save_foreign != False:
            documents = []
            embeddings = self.embedding_function([result['content'] for result in foreign_results], 'search_document')
            for i, result in enumerate(foreign_results):
                result['embeddings'] = embeddings[i]
                
                if save_foreign == True:
                    # No custom function provided, save as is
                    documents.append({
                        self.content_field: result['content'],
                        self.embeddings_field: result['embeddings']
                    })
                else:
                    # save_foreign is a custom function
                    result = save_foreign(result)
                    if result:
                        documents.append(result)
            
            # Add all in one call to make the operation atomic
            self.collection.insert_many(documents)

        return combined_results