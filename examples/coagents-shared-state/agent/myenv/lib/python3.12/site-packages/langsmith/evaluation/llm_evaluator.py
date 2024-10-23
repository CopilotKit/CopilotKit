"""Contains the LLMEvaluator class for building LLM-as-a-judge evaluators."""

from typing import Any, Callable, Dict, List, Optional, Tuple, Union, cast

from pydantic import BaseModel

from langsmith._internal._beta_decorator import warn_beta
from langsmith.evaluation import EvaluationResult, EvaluationResults, RunEvaluator
from langsmith.schemas import Example, Run


class CategoricalScoreConfig(BaseModel):
    """Configuration for a categorical score."""

    key: str
    choices: List[str]
    description: str
    include_explanation: bool = False
    explanation_description: Optional[str] = None


class ContinuousScoreConfig(BaseModel):
    """Configuration for a continuous score."""

    key: str
    min: float = 0
    max: float = 1
    description: str
    include_explanation: bool = False
    explanation_description: Optional[str] = None


def _create_score_json_schema(
    score_config: Union[CategoricalScoreConfig, ContinuousScoreConfig],
) -> dict:
    properties: Dict[str, Any] = {}
    if isinstance(score_config, CategoricalScoreConfig):
        properties["score"] = {
            "type": "string",
            "enum": score_config.choices,
            "description": f"The score for the evaluation, one of "
            f"{', '.join(score_config.choices)}.",
        }
    elif isinstance(score_config, ContinuousScoreConfig):
        properties["score"] = {
            "type": "number",
            "minimum": score_config.min,
            "maximum": score_config.max,
            "description": f"The score for the evaluation, between "
            f"{score_config.min} and {score_config.max}, inclusive.",
        }
    else:
        raise ValueError("Invalid score type. Must be 'categorical' or 'continuous'")

    if score_config.include_explanation:
        properties["explanation"] = {
            "type": "string",
            "description": (
                "The explanation for the score."
                if score_config.explanation_description is None
                else score_config.explanation_description
            ),
        }

    return {
        "title": score_config.key,
        "description": score_config.description,
        "type": "object",
        "properties": properties,
        "required": (
            ["score", "explanation"] if score_config.include_explanation else ["score"]
        ),
    }


class LLMEvaluator(RunEvaluator):
    """A class for building LLM-as-a-judge evaluators."""

    def __init__(
        self,
        *,
        prompt_template: Union[str, List[Tuple[str, str]]],
        score_config: Union[CategoricalScoreConfig, ContinuousScoreConfig],
        map_variables: Optional[Callable[[Run, Optional[Example]], dict]] = None,
        model_name: str = "gpt-4o",
        model_provider: str = "openai",
        **kwargs,
    ):
        """Initialize the LLMEvaluator.

        Args:
            prompt_template (Union[str, List[Tuple[str, str]]): The prompt
                template to use for the evaluation. If a string is provided, it is
                assumed to be a human / user message.
            score_config (Union[CategoricalScoreConfig, ContinuousScoreConfig]):
                The configuration for the score, either categorical or continuous.
            map_variables (Optional[Callable[[Run, Example], dict]], optional):
                A function that maps the run and example to the variables in the
                prompt. Defaults to None. If None, it is assumed that the prompt
                only requires 'input', 'output', and 'expected'.
            model_name (Optional[str], optional): The model to use for the evaluation.
                Defaults to "gpt-4o".
            model_provider (Optional[str], optional): The model provider to use
                for the evaluation. Defaults to "openai".
        """
        try:
            from langchain.chat_models import init_chat_model
        except ImportError as e:
            raise ImportError(
                "LLMEvaluator requires langchain to be installed. "
                "Please install langchain by running `pip install langchain`."
            ) from e

        chat_model = init_chat_model(
            model=model_name, model_provider=model_provider, **kwargs
        )

        self._initialize(prompt_template, score_config, map_variables, chat_model)

    @classmethod
    def from_model(
        cls,
        model: Any,
        *,
        prompt_template: Union[str, List[Tuple[str, str]]],
        score_config: Union[CategoricalScoreConfig, ContinuousScoreConfig],
        map_variables: Optional[Callable[[Run, Optional[Example]], dict]] = None,
    ):
        """Create an LLMEvaluator instance from a BaseChatModel instance.

        Args:
            model (BaseChatModel): The chat model instance to use for the evaluation.
            prompt_template (Union[str, List[Tuple[str, str]]): The prompt
                template to use for the evaluation. If a string is provided, it is
                assumed to be a system message.
            score_config (Union[CategoricalScoreConfig, ContinuousScoreConfig]):
                The configuration for the score, either categorical or continuous.
            map_variables (Optional[Callable[[Run, Example]], dict]], optional):
                A function that maps the run and example to the variables in the
                prompt. Defaults to None. If None, it is assumed that the prompt
                only requires 'input', 'output', and 'expected'.

        Returns:
            LLMEvaluator: An instance of LLMEvaluator.
        """
        instance = cls.__new__(cls)
        instance._initialize(prompt_template, score_config, map_variables, model)
        return instance

    def _initialize(
        self,
        prompt_template: Union[str, List[Tuple[str, str]]],
        score_config: Union[CategoricalScoreConfig, ContinuousScoreConfig],
        map_variables: Optional[Callable[[Run, Optional[Example]], dict]],
        chat_model: Any,
    ):
        """Shared initialization code for __init__ and from_model.

        Args:
            prompt_template (Union[str, List[Tuple[str, str]]): The prompt template.
            score_config (Union[CategoricalScoreConfig, ContinuousScoreConfig]):
                The score configuration.
            map_variables (Optional[Callable[[Run, Example]], dict]]):
                Function to map variables.
            chat_model (BaseChatModel): The chat model instance.
        """
        try:
            from langchain_core.language_models.chat_models import BaseChatModel
            from langchain_core.prompts import ChatPromptTemplate
        except ImportError as e:
            raise ImportError(
                "LLMEvaluator requires langchain-core to be installed. "
                "Please install langchain-core by running `pip install langchain-core`."
            ) from e

        if not (
            isinstance(chat_model, BaseChatModel)
            and hasattr(chat_model, "with_structured_output")
        ):
            raise ValueError(
                "chat_model must be an instance of "
                "BaseLanguageModel and support structured output."
            )

        if isinstance(prompt_template, str):
            self.prompt = ChatPromptTemplate.from_messages([("human", prompt_template)])
        else:
            self.prompt = ChatPromptTemplate.from_messages(prompt_template)

        if set(self.prompt.input_variables) - {"input", "output", "expected"}:
            if not map_variables:
                raise ValueError(
                    "map_inputs must be provided if the prompt template contains "
                    "variables other than 'input', 'output', and 'expected'"
                )
        self.map_variables = map_variables

        self.score_config = score_config
        self.score_schema = _create_score_json_schema(self.score_config)

        chat_model = chat_model.with_structured_output(self.score_schema)
        self.runnable = self.prompt | chat_model

    @warn_beta
    def evaluate_run(
        self, run: Run, example: Optional[Example] = None
    ) -> Union[EvaluationResult, EvaluationResults]:
        """Evaluate a run."""
        variables = self._prepare_variables(run, example)
        output: dict = cast(dict, self.runnable.invoke(variables))
        return self._parse_output(output)

    @warn_beta
    async def aevaluate_run(
        self, run: Run, example: Optional[Example] = None
    ) -> Union[EvaluationResult, EvaluationResults]:
        """Asynchronously evaluate a run."""
        variables = self._prepare_variables(run, example)
        output: dict = cast(dict, await self.runnable.ainvoke(variables))
        return self._parse_output(output)

    def _prepare_variables(self, run: Run, example: Optional[Example]) -> dict:
        """Prepare variables for model invocation."""
        if self.map_variables:
            return self.map_variables(run, example)

        variables = {}
        if "input" in self.prompt.input_variables:
            if len(run.inputs) == 0:
                raise ValueError(
                    "No input keys are present in run.inputs but the prompt "
                    "requires 'input'."
                )
            if len(run.inputs) != 1:
                raise ValueError(
                    "Multiple input keys are present in run.inputs. Please provide "
                    "a map_variables function."
                )
            variables["input"] = list(run.inputs.values())[0]

        if "output" in self.prompt.input_variables:
            if not run.outputs:
                raise ValueError(
                    "No output keys are present in run.outputs but the prompt "
                    "requires 'output'."
                )
            if len(run.outputs) == 0:
                raise ValueError(
                    "No output keys are present in run.outputs but the prompt "
                    "requires 'output'."
                )
            if len(run.outputs) != 1:
                raise ValueError(
                    "Multiple output keys are present in run.outputs. Please "
                    "provide a map_variables function."
                )
            variables["output"] = list(run.outputs.values())[0]

        if "expected" in self.prompt.input_variables:
            if not example or not example.outputs:
                raise ValueError(
                    "No example or example outputs is provided but the prompt "
                    "requires 'expected'."
                )
            if len(example.outputs) == 0:
                raise ValueError(
                    "No output keys are present in example.outputs but the prompt "
                    "requires 'expected'."
                )
            if len(example.outputs) != 1:
                raise ValueError(
                    "Multiple output keys are present in example.outputs. Please "
                    "provide a map_variables function."
                )
            variables["expected"] = list(example.outputs.values())[0]

        return variables

    def _parse_output(self, output: dict) -> Union[EvaluationResult, EvaluationResults]:
        """Parse the model output into an evaluation result."""
        if isinstance(self.score_config, CategoricalScoreConfig):
            value = output["score"]
            explanation = output.get("explanation", None)
            return EvaluationResult(
                key=self.score_config.key, value=value, comment=explanation
            )
        elif isinstance(self.score_config, ContinuousScoreConfig):
            score = output["score"]
            explanation = output.get("explanation", None)
            return EvaluationResult(
                key=self.score_config.key, score=score, comment=explanation
            )
