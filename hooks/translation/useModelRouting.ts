
import React from 'react';
import { TranslationHub } from '../../services/translationHub';
import {
  normalizeOpenRouterModelId
} from '../../utils/translationProfiles';
import type {
  OpenRouterModelCooldown,
  OpenRouterModelIssue,
  TranslationEngine
} from '../../utils/translatorShared';
import {
  AUTO_OPENROUTER_MODEL,
  DEEPSEEK_PRO_DOCX_BATCH_CHAR_LIMIT,
  DEEPSEEK_PRO_DOCX_BATCH_SIZE,
  DOCX_BATCH_CHAR_LIMIT,
  DOCX_BATCH_SIZE,
  OPENROUTER_MODEL_COOLDOWN_MS,
  getCloudflareAiProviderModel,
  getDeepSeekDirectProviderModel,
  getModelLabel,
  getTranslationModelLabel,
  isCloudflareAiModelValue,
  isDeepSeekDirectModel
} from '../../utils/translatorShared';

export interface ModelRoutingContext {
  activeDocumentQualityOpenRouterModels: string[];
  activeOpenRouterModels: string[];
  addLog: (msg: string) => void;
  allOpenRouterModels: string[];
  capabilities: { cloudflareAi: boolean; openrouter: boolean; deepseek: boolean; gemini: boolean; };
  isUsingDeepSeekPro: () => boolean;
  openRouterModelCooldownsRef: React.RefObject<Map<string, OpenRouterModelCooldown>>;
  setOpenRouterModelCooldownVersion: React.Dispatch<React.SetStateAction<number>>;
  translationHub: TranslationHub;
  translationModelPreference: string;
}

export const useModelRouting = (ctx: ModelRoutingContext) => {
  const {
    activeDocumentQualityOpenRouterModels,
    activeOpenRouterModels,
    addLog,
    allOpenRouterModels,
    capabilities,
    isUsingDeepSeekPro,
    openRouterModelCooldownsRef,
    setOpenRouterModelCooldownVersion,
    translationHub,
    translationModelPreference
  } = ctx;

  const shouldCooldownOpenRouterModel = (issue: OpenRouterModelIssue) => {
    const status = String(issue.status || '').toLowerCase();
    const message = String(issue.message || '').toLowerCase();
    return (
      status === '403' ||
      status === 'timeout' ||
      message.includes('terms of service') ||
      message.includes('timed out') ||
      message.includes('timeout')
    );
  };

const applyOpenRouterModelCooldowns = (
    issues: OpenRouterModelIssue[],
    contextLabel: string
  ) => {
    if (translationModelPreference !== AUTO_OPENROUTER_MODEL || issues.length === 0) return;
    const now = Date.now();
    let changed = false;
    issues.forEach((issue) => {
      const model = normalizeOpenRouterModelId(String(issue.model || ''));
      if (!model || !allOpenRouterModels.includes(model)) return;
      if (!shouldCooldownOpenRouterModel(issue)) return;
      const reason = issue.status === 403 || String(issue.status) === '403'
        ? '403 TOS/permission block'
        : String(issue.status || issue.message || 'temporary failure');
      const existing = openRouterModelCooldownsRef.current.get(model);
      const until = now + OPENROUTER_MODEL_COOLDOWN_MS;
      if (existing && existing.until >= until - 1000) return;
      openRouterModelCooldownsRef.current.set(model, { until, reason });
      changed = true;
      addLog(
        `${contextLabel}: ${getModelLabel(model)} ${reason}，Auto 将跳过 30 分钟。`
      );
    });
    if (changed) {
      setOpenRouterModelCooldownVersion((version) => version + 1);
    }
  };

const applyLatestOpenRouterModelCooldowns = (contextLabel: string) => {
    const issues = translationHub.getLastModelIssues?.() || [];
    applyOpenRouterModelCooldowns(issues as OpenRouterModelIssue[], contextLabel);
  };

const getFallbackPriority = (
    respectSelectedEngine: boolean = false
  ): TranslationEngine[] => {
    const engines: TranslationEngine[] = [];
    if (capabilities.cloudflareAi) engines.push('cloudflare-ai');
    if (capabilities.deepseek) engines.push('deepseek');
    if (capabilities.openrouter) engines.push('openrouter');
    if (capabilities.gemini) engines.push('gemini');

    if (respectSelectedEngine && translationModelPreference !== AUTO_OPENROUTER_MODEL) {
      if (isCloudflareAiModelValue(translationModelPreference) && capabilities.cloudflareAi) {
        return ['cloudflare-ai'];
      }
      if (isDeepSeekDirectModel(translationModelPreference) && capabilities.deepseek) {
        return ['deepseek'];
      }
      if (capabilities.openrouter) return ['openrouter'];
    }

    return engines.length > 0 ? engines : ['openrouter'];
  };

const getRetryAttemptModelLabel = (model: TranslationEngine) => {
    if (translationModelPreference !== AUTO_OPENROUTER_MODEL) {
      if (
        model === 'cloudflare-ai' &&
        isCloudflareAiModelValue(translationModelPreference)
      ) {
        return getTranslationModelLabel(translationModelPreference);
      }
      if (model === 'deepseek' && isDeepSeekDirectModel(translationModelPreference)) {
        return getTranslationModelLabel(translationModelPreference);
      }
      if (
        model === 'openrouter' &&
        !isCloudflareAiModelValue(translationModelPreference) &&
        !isDeepSeekDirectModel(translationModelPreference)
      ) {
        return getTranslationModelLabel(translationModelPreference);
      }
    }
    if (model === 'cloudflare-ai') return 'Cloudflare AI';
    if (model === 'deepseek') return 'DeepSeek Direct';
    if (model === 'openrouter') return 'OpenRouter';
    if (model === 'gemini') return 'Gemini';
    return model;
  };

const getTranslationOptions = () => {
    if (translationModelPreference === AUTO_OPENROUTER_MODEL) {
      return {
        openRouterModels: activeOpenRouterModels
      };
    }
    if (isCloudflareAiModelValue(translationModelPreference)) {
      return {
        model: 'cloudflare-ai' as const,
        providerModel: getCloudflareAiProviderModel(translationModelPreference)
      };
    }
    if (isDeepSeekDirectModel(translationModelPreference)) {
      return {
        model: 'deepseek' as const,
        providerModel: getDeepSeekDirectProviderModel(translationModelPreference)
      };
    }
    return {
      model: 'openrouter' as const,
      openRouterModel: translationModelPreference
    };
  };

const getDocumentQualityTranslationOptions = () => {
    if (translationModelPreference !== AUTO_OPENROUTER_MODEL) {
      if (isCloudflareAiModelValue(translationModelPreference)) {
        return {
          model: 'cloudflare-ai' as const,
          providerModel: getCloudflareAiProviderModel(translationModelPreference),
          profile: 'docx-manual' as const
        };
      }
      if (isDeepSeekDirectModel(translationModelPreference)) {
        return {
          model: 'deepseek' as const,
          providerModel: getDeepSeekDirectProviderModel(translationModelPreference),
          profile: 'docx-manual' as const
        };
      }
      return {
        model: 'openrouter' as const,
        openRouterModel: translationModelPreference,
        profile: 'docx-manual' as const
      };
    }
    return {
      profile: 'docx-manual' as const,
      openRouterModels: activeDocumentQualityOpenRouterModels
    };
  };

const getDocumentBatchPolicy = () =>
    isUsingDeepSeekPro()
      ? {
          maxItems: DEEPSEEK_PRO_DOCX_BATCH_SIZE,
          maxChars: DEEPSEEK_PRO_DOCX_BATCH_CHAR_LIMIT,
          label: 'DeepSeek Pro conservative'
        }
      : {
          maxItems: DOCX_BATCH_SIZE,
          maxChars: DOCX_BATCH_CHAR_LIMIT,
          label: 'standard'
        };

  return {
    applyLatestOpenRouterModelCooldowns,
    getFallbackPriority,
    getRetryAttemptModelLabel,
    getTranslationOptions,
    getDocumentQualityTranslationOptions,
    getDocumentBatchPolicy
  };
};
