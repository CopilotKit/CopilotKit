#!/usr/bin/env python3
"""
Mastra Message History Support for CopilotKit
Fixes Issue #1881: Mastra Message History Support

This module provides message history management for Mastra agents,
enabling thread reloading and state restoration.
"""

from typing import List, Dict, Any, Optional
from datetime import datetime
import json


class MastraMessageHistory:
    """
    Manages message history for Mastra agents.
    Provides persistence, retrieval, and thread management capabilities.
    """
    
    def __init__(self, storage_backend: Optional[Any] = None):
        """
        Initialize message history manager.
        
        Args:
            storage_backend: Optional storage backend (e.g., Redis, Database)
        """
        self._storage = storage_backend or {}
        self._message_cache: Dict[str, List[Dict[str, Any]]] = {}
    
    async def get_messages(
        self, 
        thread_id: str, 
        limit: Optional[int] = None,
        before_timestamp: Optional[datetime] = None
    ) -> List[Dict[str, Any]]:
        """
        Retrieve messages for a thread.
        
        Args:
            thread_id: The thread identifier
            limit: Maximum number of messages to return
            before_timestamp: Only return messages before this time
            
        Returns:
            List of message dictionaries
        """
        messages = self._message_cache.get(thread_id, [])
        
        if before_timestamp:
            messages = [
                msg for msg in messages 
                if msg.get("timestamp", datetime.now()) < before_timestamp
            ]
        
        if limit:
            messages = messages[-limit:]
            
        return messages
    
    async def add_message(
        self, 
        thread_id: str, 
        message: Dict[str, Any]
    ) -> None:
        """
        Add a message to the thread history.
        
        Args:
            thread_id: The thread identifier
            message: Message dictionary with role, content, etc.
        """
        if thread_id not in self._message_cache:
            self._message_cache[thread_id] = []
        
        # Add timestamp if not present
        if "timestamp" not in message:
            message["timestamp"] = datetime.now().isoformat()
        
        self._message_cache[thread_id].append(message)
        
        # Persist to storage if available
        if self._storage and hasattr(self._storage, 'save'):
            await self._storage.save(thread_id, self._message_cache[thread_id])
    
    async def clear_history(self, thread_id: str) -> None:
        """Clear message history for a thread."""
        self._message_cache[thread_id] = []
        if self._storage and hasattr(self._storage, 'delete'):
            await self._storage.delete(thread_id)
    
    async def get_thread_state(self, thread_id: str) -> Dict[str, Any]:
        """
        Get the current state of a thread including messages.
        
        Args:
            thread_id: The thread identifier
            
        Returns:
            Thread state dictionary
        """
        messages = await self.get_messages(thread_id)
        return {
            "threadId": thread_id,
            "threadExists": len(messages) > 0,
            "messages": messages,
            "messageCount": len(messages),
            "lastUpdated": messages[-1].get("timestamp") if messages else None
        }


class MastraThreadManager:
    """
    Manages thread lifecycle for Mastra agents.
    Provides thread creation, loading, and restoration.
    """
    
    def __init__(self, message_history: Optional[MastraMessageHistory] = None):
        self._history = message_history or MastraMessageHistory()
        self._active_threads: Dict[str, Dict[str, Any]] = {}
    
    async def create_thread(
        self, 
        thread_id: Optional[str] = None,
        initial_state: Optional[Dict[str, Any]] = None
    ) -> str:
        """
        Create a new thread.
        
        Args:
            thread_id: Optional thread ID (generated if not provided)
            initial_state: Optional initial state
            
        Returns:
            The thread ID
        """
        import uuid
        tid = thread_id or str(uuid.uuid4())
        
        self._active_threads[tid] = {
            "created_at": datetime.now().isoformat(),
            "state": initial_state or {},
            "status": "active"
        }
        
        return tid
    
    async def load_thread(
        self, 
        thread_id: str,
        include_history: bool = True
    ) -> Dict[str, Any]:
        """
        Load an existing thread with its history.
        
        Args:
            thread_id: The thread identifier
            include_history: Whether to include message history
            
        Returns:
            Thread data including messages and state
        """
        thread_state = await self._history.get_thread_state(thread_id)
        
        if thread_id in self._active_threads:
            thread_state["activeState"] = self._active_threads[thread_id]
        
        return thread_state
    
    async def restore_thread(
        self, 
        thread_id: str,
        messages: List[Dict[str, Any]],
        state: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        Restore a thread with specific messages and state.
        
        Args:
            thread_id: The thread identifier
            messages: List of messages to restore
            state: Optional state to restore
        """
        # Clear existing history
        await self._history.clear_history(thread_id)
        
        # Restore messages
        for msg in messages:
            await self._history.add_message(thread_id, msg)
        
        # Update active thread state
        self._active_threads[thread_id] = {
            "restored_at": datetime.now().isoformat(),
            "state": state or {},
            "status": "restored"
        }


# Export for use in Mastra integration
__all__ = ['MastraMessageHistory', 'MastraThreadManager']
