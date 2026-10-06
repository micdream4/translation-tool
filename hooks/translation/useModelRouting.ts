import { TranslationHub } from '../../services/translationHub';
import type { TranslationEngine } from '../../utils/translatorShared';
import {
  AUTO_MODEL,
  DEEPSEEK_PRO_DOCX_BATCH_CHAR_LIMIT,
  DEEPSEEK_PRO_DOCX_BATCH_SIZE,
  DOCX_BATCH_CHAR_LIMIT,
  DOCX_BATCH_SIZE,
  getCloudflareAiProviderModel,
  getDeepSeekDirectProviderModel,
  getTranslationModelLabel,
  isCloudflareAiModelValue,
  isDeepSeekDirectModel
} from '../../utils/translatorShared';

export interface ModelRoutingContext {
  capabilities: { cloudflareAi: boolean; deepseek: boolean; gemini: boolean };
  isUsingDeepSeekPro: () => boolean;
  translationHub: TranslationHub;
  translationModelPreference: string;
}

export const useModelRouting = (ctx: ModelRoutingContext) => {
  const { capabilities, isUsingDeepSeekPro, translationModelPreference } = ctx;

  const getFallbackPriority = (respectSelectedEngine: boolean = false): TranslationEngine[] => {
    const engines: TranslationEngine[] = [];
    if (capabilities.cloudflareAi) engines.push('cloudflare-ai');
    if (capabilities.deepseek) engines.push('deepseek');
    if (capabilities.gemini) engines.push('gemini');

    if (respectSelectedEngine && translationModelPreference !== AUTO_MODEL) {
      if (isCloudflareAiModelValue(translationModelPreference) && capabilities.cloudflareAi) {
        return ['cloudflare-ai'];
      }
      if (isDeepSeekDirectModel(translationModelPreference) && capabilities.deepseek) {
        return ['deepseek'];
      }
    }

    return engines.length > 0 ? engines : ['cloudflare-ai'];
  };

  const getRetryAttemptModelLabel = (model: TranslationEngine) => {
    if (translationModelPreference !== AUTO_MODEL) {
      if (model === 'cloudflare-ai' && isCloudflareAiModelValue(translationModelPreference)) {
        return getTranslationModelLabel(translationModelPreference);
      }
      if (model === 'deepseek' && isDeepSeekDirectModel(translationModelPreference)) {
        return getTranslationModelLabel(translationModelPreference);
      }
    }
    if (model === 'cloudflare-ai') return 'Cloudflare AI';
    if (model === 'deepseek') return 'DeepSeek Direct';
    if (model === 'gemini') return 'Gemini';
    return model;
  };

  const getTranslationOptions = () => {
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
    return {};
  };

  const getDocumentQualityTranslationOptions = () => ({
    ...getTranslationOptions(),
    profile: 'docx-manual' as const
  });

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
    getFallbackPriority,
    getRetryAttemptModelLabel,
    getTranslationOptions,
    getDocumentQualityTranslationOptions,
    getDocumentBatchPolicy
  };
};
