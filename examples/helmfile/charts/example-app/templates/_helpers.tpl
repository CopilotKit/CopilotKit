{{/*
Expand the name of the chart.
*/}}
{{- define "example-app.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "example-app.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "example-app.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Validate that environment is set
*/}}
{{- define "example-app.environment" -}}
{{- if not .Values.environment }}
{{- fail "environment must be set in values" }}
{{- end }}
{{- printf "%s" .Values.environment }}
{{- end }}

{{/*
Convert JSON string to Kubernetes environment variables
*/}}
{{- define "example-app.jsonToEnv" -}}
{{- $json := . -}}
{{- range $key, $value := $json }}
- name: {{ $key }}
  value: {{ $value | quote }}
{{- end }}
{{- end -}}
