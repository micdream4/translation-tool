import type { TargetLanguage } from '../types';

export type TargetLanguageProfile = {
  target: string;
  script: 'latin' | 'cyrillic' | 'cjk';
  preferredLocale?: string;
  disallowedLatinResidueWords?: string[];
  englishResidueWords?: string[];
  englishResiduePhrases?: string[];
  diacriticRiskWords?: Array<{ plain: string; preferred: string }>;
  commonFunctionWords?: string[];
  distinctiveCharacters?: RegExp;
  notes: string[];
};

const normalizeLatinToken = (value: string) =>
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '');

export const RUSSIAN_DISALLOWED_LATIN_RESIDUE_WORDS = [
  'analysis',
  'blood',
  'building',
  'cell',
  'city',
  'control',
  'count',
  'device',
  'district',
  'establish',
  'feces',
  'home',
  'hour',
  'list',
  'lists',
  'maintenance',
  'operation',
  'order',
  'orders',
  'page',
  'preparation',
  'province',
  'reference',
  'references',
  'report',
  'reports',
  'result',
  'results',
  'ref',
  'sample',
  'service',
  'services',
  'setting',
  'settings',
  'street',
  'successful',
  'support',
  'uncertain',
  'white',
  'year'
];

const RUSSIAN_DISALLOWED_LATIN_RESIDUE_SET = new Set(
  RUSSIAN_DISALLOWED_LATIN_RESIDUE_WORDS.map(normalizeLatinToken)
);

export const FRENCH_ENGLISH_RESIDUE_WORDS = [
  'blue',
  'button',
  'consumables',
  'lifted',
  'quickly',
  'remove',
  'removed',
  'squeeze',
  'testing'
];

export const FRENCH_ENGLISH_RESIDUE_PHRASES = [
  'quickly squeeze',
  'blue button',
  'the blue button is lifted'
];

export const FRENCH_DIACRITIC_RISK_WORDS = [
  { plain: 'hemoglobine', preferred: 'hémoglobine' },
  { plain: 'anemie', preferred: 'anémie' },
  { plain: 'anemique', preferred: 'anémique' },
  { plain: 'anemiques', preferred: 'anémiques' },
  { plain: 'evaluation', preferred: 'évaluation' },
  { plain: 'evalue', preferred: 'évalue' },
  { plain: 'combinee', preferred: 'combinée' },
  { plain: 'necessaire', preferred: 'nécessaire' },
  { plain: 'hematologique', preferred: 'hématologique' },
  { plain: 'hematologiques', preferred: 'hématologiques' },
  { plain: 'hematopoiese', preferred: 'hématopoïèse' },
  { plain: 'leucemie', preferred: 'leucémie' },
  { plain: 'myelodysplasique', preferred: 'myélodysplasique' },
  { plain: 'myeloide', preferred: 'myéloïde' },
  { plain: 'myeloides', preferred: 'myéloïdes' },
  { plain: 'hemolytique', preferred: 'hémolytique' },
  { plain: 'hemolyse', preferred: 'hémolyse' },
  { plain: 'reticulocytes', preferred: 'réticulocytes' },
  { plain: 'spherocytes', preferred: 'sphérocytes' },
  { plain: 'alteration', preferred: 'altération' },
  { plain: 'peripherique', preferred: 'périphérique' },
  { plain: 'peripheriques', preferred: 'périphériques' },
  { plain: 'frequent', preferred: 'fréquent' },
  { plain: 'frequente', preferred: 'fréquente' },
  { plain: 'frequents', preferred: 'fréquents' },
  { plain: 'frequentes', preferred: 'fréquentes' },
  { plain: 'neutropenie', preferred: 'neutropénie' },
  { plain: 'medullaire', preferred: 'médullaire' },
  { plain: 'medullaires', preferred: 'médullaires' },
  { plain: 'toxicite', preferred: 'toxicité' },
  { plain: 'liberation', preferred: 'libération' },
  { plain: 'lignee', preferred: 'lignée' },
  { plain: 'lignees', preferred: 'lignées' },
  { plain: 'recuperation', preferred: 'récupération' },
  { plain: 'reactive', preferred: 'réactive' },
  { plain: 'reactionnel', preferred: 'réactionnel' },
  { plain: 'reactionnels', preferred: 'réactionnels' },
  { plain: 'mononucleose', preferred: 'mononucléose' },
  { plain: 'hepatite', preferred: 'hépatite' },
  { plain: 'cytomegalovirus', preferred: 'cytomégalovirus' },
  { plain: 'reactions', preferred: 'réactions' },
  { plain: 'medicamenteuse', preferred: 'médicamenteuse' },
  { plain: 'medicamenteuses', preferred: 'médicamenteuses' },
  { plain: 'medicamenteux', preferred: 'médicamenteux' },
  { plain: 'peut-etre', preferred: 'peut-être' },
  { plain: 'complementaire', preferred: 'complémentaire' },
  { plain: 'symptomes', preferred: 'symptômes' },
  { plain: 'myelogramme', preferred: 'myélogramme' },
  { plain: 'etiologie', preferred: 'étiologie' },
  { plain: 'myelofibrose', preferred: 'myélofibrose' },
  { plain: 'serique', preferred: 'sérique' },
  { plain: 'hemopathie', preferred: 'hémopathie' },
  { plain: 'resultat', preferred: 'résultat' },
  { plain: 'resultats', preferred: 'résultats' },
  { plain: 'systeme', preferred: 'système' },
  { plain: 'reference', preferred: 'référence' },
  { plain: 'inferieur', preferred: 'inférieur' },
  { plain: 'inferieure', preferred: 'inférieure' },
  { plain: 'superieur', preferred: 'supérieur' },
  { plain: 'superieure', preferred: 'supérieure' },
  { plain: 'reactionnelle', preferred: 'réactionnelle' },
  { plain: 'defaut', preferred: 'défaut' },
  { plain: 'deficit', preferred: 'déficit' },
  { plain: 'medicaments', preferred: 'médicaments' },
  { plain: 'declencher', preferred: 'déclencher' },
  { plain: 'presence', preferred: 'présence' },
  { plain: 'reaction', preferred: 'réaction' },
  { plain: 'reactions', preferred: 'réactions' },
  { plain: 'reponse', preferred: 'réponse' },
  { plain: 'reponses', preferred: 'réponses' },
  { plain: 'suggerer', preferred: 'suggérer' },
  { plain: 'suggerent', preferred: 'suggèrent' },
  { plain: 'suggerant', preferred: 'suggérant' },
  { plain: 'eleve', preferred: 'élevé' },
  { plain: 'eleves', preferred: 'élevés' },
  { plain: 'elevee', preferred: 'élevée' },
  { plain: 'elevees', preferred: 'élevées' },
  { plain: 'diminues', preferred: 'diminués' },
  { plain: 'diminuee', preferred: 'diminuée' },
  { plain: 'diminuees', preferred: 'diminuées' },
  { plain: 'elevation', preferred: 'élévation' },
  { plain: 'synthese', preferred: 'synthèse' },
  { plain: 'reserves', preferred: 'réserves' },
  { plain: 'suggere', preferred: 'suggère' },
  { plain: 'leger', preferred: 'léger' },
  { plain: 'legere', preferred: 'légère' },
  { plain: 'modere', preferred: 'modéré' },
  { plain: 'moderee', preferred: 'modérée' },
  { plain: 'severe', preferred: 'sévère' },
  { plain: 'severes', preferred: 'sévères' },
  { plain: 'tres', preferred: 'très' },
  { plain: 'necessitant', preferred: 'nécessitant' },
  { plain: 'necessite', preferred: 'nécessite' },
  { plain: 'necessitent', preferred: 'nécessitent' },
  { plain: 'evaluer', preferred: 'évaluer' },
  { plain: 'evaluee', preferred: 'évaluée' },
  { plain: 'parametre', preferred: 'paramètre' },
  { plain: 'parametres', preferred: 'paramètres' },
  { plain: 'caracterisee', preferred: 'caractérisée' },
  { plain: 'caracterise', preferred: 'caractérise' },
  { plain: 'caracteristiques', preferred: 'caractéristiques' },
  { plain: 'hematopoietique', preferred: 'hématopoïétique' },
  { plain: 'hematopoietiques', preferred: 'hématopoïétiques' },
  { plain: 'mecanisme', preferred: 'mécanisme' },
  { plain: 'mecanismes', preferred: 'mécanismes' },
  { plain: 'generalement', preferred: 'généralement' },
  { plain: 'simultanee', preferred: 'simultanée' },
  { plain: 'associe', preferred: 'associé' },
  { plain: 'associee', preferred: 'associée' },
  { plain: 'associes', preferred: 'associés' },
  { plain: 'associees', preferred: 'associées' },
  { plain: 'libere', preferred: 'libéré' },
  { plain: 'liberee', preferred: 'libérée' },
  { plain: 'liberant', preferred: 'libérant' },
  { plain: 'precoce', preferred: 'précoce' },
  { plain: 'precoces', preferred: 'précoces' },
  { plain: 'bacterienne', preferred: 'bactérienne' },
  { plain: 'bacteriennes', preferred: 'bactériennes' },
  { plain: 'possibilite', preferred: 'possibilité' },
  { plain: 'capacite', preferred: 'capacité' },
  { plain: 'aigue', preferred: 'aiguë' },
  { plain: 'deplacement', preferred: 'déplacement' },
  { plain: 'deviation', preferred: 'déviation' },
  { plain: 'nucleaire', preferred: 'nucléaire' },
  { plain: 'polynucleees', preferred: 'polynucléées' },
  { plain: 'apres', preferred: 'après' },
  { plain: 'antimetabolite', preferred: 'antimétabolite' },
  { plain: 'antimetabolites', preferred: 'antimétabolites' },
  { plain: 'presentation', preferred: 'présentation' },
  { plain: 'determiner', preferred: 'déterminer' },
  { plain: 'determine', preferred: 'détermine' },
  { plain: 'immunite', preferred: 'immunité' },
  { plain: 'apparaitre', preferred: 'apparaître' },
  { plain: 'presente', preferred: 'présente' },
  { plain: 'presentent', preferred: 'présentent' },
  { plain: 'cutanee', preferred: 'cutanée' },
  { plain: 'cutanees', preferred: 'cutanées' },
  { plain: 'eczema', preferred: 'eczéma' },
  { plain: 'hemogramme', preferred: 'hémogramme' },
  { plain: 'debut', preferred: 'début' },
  { plain: 'entraine', preferred: 'entraîne' },
  { plain: 'entrainant', preferred: 'entraînant' },
  { plain: 'entrainer', preferred: 'entraîner' },
  { plain: 'liee', preferred: 'liée' },
  { plain: 'leucopenie', preferred: 'leucopénie' },
  { plain: 'egalement', preferred: 'également' },
  { plain: 'reduction', preferred: 'réduction' },
  { plain: 'commence', preferred: 'commencé' },
  { plain: 'accelerer', preferred: 'accélérer' },
  { plain: 'etat', preferred: 'état' },
  { plain: 'anemic', preferred: 'anémie' },
  { plain: 'megaloblastique', preferred: 'mégaloblastique' },
  { plain: 'parallelement', preferred: 'parallèlement' },
  { plain: 'accompagnee', preferred: 'accompagnée' },
  { plain: 'accompagne', preferred: 'accompagné' },
  { plain: 'eosinophile', preferred: 'éosinophile' },
  { plain: 'eosinophiles', preferred: 'éosinophiles' },
  { plain: 'renforcee', preferred: 'renforcée' },
  { plain: 'renforce', preferred: 'renforcé' }
];

export const PORTUGUESE_DIACRITIC_RISK_WORDS = [
  { plain: 'acido', preferred: 'ácido' },
  { plain: 'agudissima', preferred: 'agudíssima' },
  { plain: 'acao', preferred: 'ação' },
  { plain: 'alem', preferred: 'além' },
  { plain: 'alergica', preferred: 'alérgica' },
  { plain: 'alergicas', preferred: 'alérgicas' },
  { plain: 'alergico', preferred: 'alérgico' },
  { plain: 'alergicos', preferred: 'alérgicos' },
  { plain: 'alteracao', preferred: 'alteração' },
  { plain: 'alteracoes', preferred: 'alterações' },
  { plain: 'antimetabolito', preferred: 'antimetabólito' },
  { plain: 'antimetabolitos', preferred: 'antimetabólitos' },
  { plain: 'anemica', preferred: 'anêmica' },
  { plain: 'anemicas', preferred: 'anêmicas' },
  { plain: 'anemico', preferred: 'anêmico' },
  { plain: 'anemicos', preferred: 'anêmicos' },
  { plain: 'absorcao', preferred: 'absorção' },
  { plain: 'apresentacao', preferred: 'apresentação' },
  { plain: 'aplastica', preferred: 'aplástica' },
  { plain: 'aplasticas', preferred: 'aplásticas' },
  { plain: 'aplastico', preferred: 'aplástico' },
  { plain: 'aplasticos', preferred: 'aplásticos' },
  { plain: 'apos', preferred: 'após' },
  { plain: 'aspiracao', preferred: 'aspiração' },
  { plain: 'atipico', preferred: 'atípico' },
  { plain: 'atipicos', preferred: 'atípicos' },
  { plain: 'ativacao', preferred: 'ativação' },
  { plain: 'avaliacao', preferred: 'avaliação' },
  { plain: 'bacteria', preferred: 'bactéria' },
  { plain: 'bacterias', preferred: 'bactérias' },
  { plain: 'bastao', preferred: 'bastão' },
  { plain: 'basofilo', preferred: 'basófilo' },
  { plain: 'basofilos', preferred: 'basófilos' },
  { plain: 'celula', preferred: 'célula' },
  { plain: 'celulas', preferred: 'células' },
  { plain: 'caracteristica', preferred: 'característica' },
  { plain: 'caracteristicas', preferred: 'características' },
  { plain: 'citologica', preferred: 'citológica' },
  { plain: 'citologicas', preferred: 'citológicas' },
  { plain: 'citomegalovirus', preferred: 'citomegalovírus' },
  { plain: 'clinica', preferred: 'clínica' },
  { plain: 'clinicas', preferred: 'clínicas' },
  { plain: 'clinico', preferred: 'clínico' },
  { plain: 'clinicos', preferred: 'clínicos' },
  { plain: 'classificacao', preferred: 'classificação' },
  { plain: 'combinacao', preferred: 'combinação' },
  { plain: 'compensatoria', preferred: 'compensatória' },
  { plain: 'confirmacao', preferred: 'confirmação' },
  { plain: 'condicao', preferred: 'condição' },
  { plain: 'condicoes', preferred: 'condições' },
  { plain: 'consideracao', preferred: 'consideração' },
  { plain: 'consideracoes', preferred: 'considerações' },
  { plain: 'continuacao', preferred: 'continuação' },
  { plain: 'correlacao', preferred: 'correlação' },
  { plain: 'cronica', preferred: 'crônica' },
  { plain: 'cronicas', preferred: 'crônicas' },
  { plain: 'cronico', preferred: 'crônico' },
  { plain: 'cronicos', preferred: 'crônicos' },
  { plain: 'deficiencia', preferred: 'deficiência' },
  { plain: 'desnutricao', preferred: 'desnutrição' },
  { plain: 'destruicao', preferred: 'destruição' },
  { plain: 'diagnostico', preferred: 'diagnóstico' },
  { plain: 'desequilibrio', preferred: 'desequilíbrio' },
  { plain: 'dietetica', preferred: 'dietética' },
  { plain: 'dieteticas', preferred: 'dietéticas' },
  { plain: 'dietetico', preferred: 'dietético' },
  { plain: 'dieteticos', preferred: 'dietéticos' },
  { plain: 'diminuicao', preferred: 'diminuição' },
  { plain: 'diminuida', preferred: 'diminuída' },
  { plain: 'diminuido', preferred: 'diminuído' },
  { plain: 'diminuídas', preferred: 'diminuídas' },
  { plain: 'diminuídos', preferred: 'diminuídos' },
  { plain: 'disfuncao', preferred: 'disfunção' },
  { plain: 'desregulacao', preferred: 'desregulação' },
  { plain: 'disturbio', preferred: 'distúrbio' },
  { plain: 'disturbios', preferred: 'distúrbios' },
  { plain: 'doenca', preferred: 'doença' },
  { plain: 'doencas', preferred: 'doenças' },
  { plain: 'elevacao', preferred: 'elevação' },
  { plain: 'eosinofilo', preferred: 'eosinófilo' },
  { plain: 'eosinofilos', preferred: 'eosinófilos' },
  { plain: 'eritrocito', preferred: 'eritrócito' },
  { plain: 'eritrocitario', preferred: 'eritrocitário' },
  { plain: 'eritrocitarios', preferred: 'eritrocitários' },
  { plain: 'eritrocitos', preferred: 'eritrócitos' },
  { plain: 'esfregaco', preferred: 'esfregaço' },
  { plain: 'estao', preferred: 'estão' },
  { plain: 'estagio', preferred: 'estágio' },
  { plain: 'estavel', preferred: 'estável' },
  { plain: 'estaveis', preferred: 'estáveis' },
  { plain: 'estimulo', preferred: 'estímulo' },
  { plain: 'etiologica', preferred: 'etiológica' },
  { plain: 'etiologicas', preferred: 'etiológicas' },
  { plain: 'etiologico', preferred: 'etiológico' },
  { plain: 'etiologicos', preferred: 'etiológicos' },
  { plain: 'evidencia', preferred: 'evidência' },
  { plain: 'evidencias', preferred: 'evidências' },
  { plain: 'farmaco', preferred: 'fármaco' },
  { plain: 'farmacos', preferred: 'fármacos' },
  { plain: 'fenomeno', preferred: 'fenômeno' },
  { plain: 'fisico', preferred: 'físico' },
  { plain: 'folico', preferred: 'fólico' },
  { plain: 'funcao', preferred: 'função' },
  { plain: 'funcoes', preferred: 'funções' },
  { plain: 'granulocito', preferred: 'granulócito' },
  { plain: 'granulocitos', preferred: 'granulócitos' },
  { plain: 'hematologica', preferred: 'hematológica' },
  { plain: 'hematologicas', preferred: 'hematológicas' },
  { plain: 'hematologico', preferred: 'hematológico' },
  { plain: 'hematologicos', preferred: 'hematológicos' },
  { plain: 'hematopoetica', preferred: 'hematopoética' },
  { plain: 'hematopoeticas', preferred: 'hematopoéticas' },
  { plain: 'hematopoetico', preferred: 'hematopoético' },
  { plain: 'hematopoeticos', preferred: 'hematopoéticos' },
  { plain: 'hematopoietica', preferred: 'hematopoética' },
  { plain: 'hereditaria', preferred: 'hereditária' },
  { plain: 'hereditarias', preferred: 'hereditárias' },
  { plain: 'hereditario', preferred: 'hereditário' },
  { plain: 'hereditarios', preferred: 'hereditários' },
  { plain: 'hemolitica', preferred: 'hemolítica' },
  { plain: 'hemolise', preferred: 'hemólise' },
  { plain: 'hematica', preferred: 'hemática' },
  { plain: 'hematicas', preferred: 'hemáticas' },
  { plain: 'hematico', preferred: 'hemático' },
  { plain: 'hematicos', preferred: 'hemáticos' },
  { plain: 'hipocromica', preferred: 'hipocrômica' },
  { plain: 'hipocromicas', preferred: 'hipocrômicas' },
  { plain: 'hipocromico', preferred: 'hipocrômico' },
  { plain: 'hipocromicos', preferred: 'hipocrômicos' },
  { plain: 'hipofuncao', preferred: 'hipofunção' },
  { plain: 'historia', preferred: 'história' },
  { plain: 'historico', preferred: 'histórico' },
  { plain: 'imunologica', preferred: 'imunológica' },
  { plain: 'imunologicas', preferred: 'imunológicas' },
  { plain: 'imunologico', preferred: 'imunológico' },
  { plain: 'imunologicos', preferred: 'imunológicos' },
  { plain: 'imunossupressao', preferred: 'imunossupressão' },
  { plain: 'indicacao', preferred: 'indicação' },
  { plain: 'indicacoes', preferred: 'indicações' },
  { plain: 'infeccao', preferred: 'infecção' },
  { plain: 'infeccoes', preferred: 'infecções' },
  { plain: 'ingestao', preferred: 'ingestão' },
  { plain: 'inflamacoes', preferred: 'inflamações' },
  { plain: 'inflamacao', preferred: 'inflamação' },
  { plain: 'inflamatoria', preferred: 'inflamatória' },
  { plain: 'inflamatorias', preferred: 'inflamatórias' },
  { plain: 'inflamatorio', preferred: 'inflamatório' },
  { plain: 'inflamatorios', preferred: 'inflamatórios' },
  { plain: 'intoxicacao', preferred: 'intoxicação' },
  { plain: 'interdependencia', preferred: 'interdependência' },
  { plain: 'inter-relacao', preferred: 'inter-relação' },
  { plain: 'eliminacao', preferred: 'eliminação' },
  { plain: 'lesao', preferred: 'lesão' },
  { plain: 'leucocitaria', preferred: 'leucocitária' },
  { plain: 'leucocitarias', preferred: 'leucocitárias' },
  { plain: 'leucocitario', preferred: 'leucocitário' },
  { plain: 'leucocitarios', preferred: 'leucocitários' },
  { plain: 'leucocito', preferred: 'leucócito' },
  { plain: 'leucocitos', preferred: 'leucócitos' },
  { plain: 'liberacao', preferred: 'liberação' },
  { plain: 'ligacao', preferred: 'ligação' },
  { plain: 'linfocito', preferred: 'linfócito' },
  { plain: 'linfocitos', preferred: 'linfócitos' },
  { plain: 'linfocitica', preferred: 'linfocítica' },
  { plain: 'linfocitaria', preferred: 'linfocitária' },
  { plain: 'linfocitarias', preferred: 'linfocitárias' },
  { plain: 'linfocitario', preferred: 'linfocitário' },
  { plain: 'linfocitarios', preferred: 'linfocitários' },
  { plain: 'macrocitica', preferred: 'macrocítica' },
  { plain: 'macrociticas', preferred: 'macrocíticas' },
  { plain: 'macrocitico', preferred: 'macrocítico' },
  { plain: 'macrociticos', preferred: 'macrocíticos' },
  { plain: 'manifestacao', preferred: 'manifestação' },
  { plain: 'manifestacoes', preferred: 'manifestações' },
  { plain: 'medula ossea', preferred: 'medula óssea' },
  { plain: 'medicacao', preferred: 'medicação' },
  { plain: 'medico', preferred: 'médico' },
  { plain: 'medicos', preferred: 'médicos' },
  { plain: 'maturacao', preferred: 'maturação' },
  { plain: 'media', preferred: 'média' },
  { plain: 'medio', preferred: 'médio' },
  { plain: 'megaloblastica', preferred: 'megaloblástica' },
  { plain: 'menstruacao', preferred: 'menstruação' },
  { plain: 'metabolica', preferred: 'metabólica' },
  { plain: 'metabolicas', preferred: 'metabólicas' },
  { plain: 'metabolico', preferred: 'metabólico' },
  { plain: 'metabolicos', preferred: 'metabólicos' },
  { plain: 'metamielocito', preferred: 'metamielócito' },
  { plain: 'metamielocitos', preferred: 'metamielócitos' },
  { plain: 'microcitica', preferred: 'microcítica' },
  { plain: 'microciticas', preferred: 'microcíticas' },
  { plain: 'microcitico', preferred: 'microcítico' },
  { plain: 'microciticos', preferred: 'microcíticos' },
  { plain: 'mielodisplasica', preferred: 'mielodisplásica' },
  { plain: 'mielodisplasicas', preferred: 'mielodisplásicas' },
  { plain: 'mielodisplasico', preferred: 'mielodisplásico' },
  { plain: 'mielodisplasicos', preferred: 'mielodisplásicos' },
  { plain: 'mielocito', preferred: 'mielócito' },
  { plain: 'mielocitos', preferred: 'mielócitos' },
  { plain: 'monocito', preferred: 'monócito' },
  { plain: 'monocitos', preferred: 'monócitos' },
  { plain: 'mobilizacao', preferred: 'mobilização' },
  { plain: 'morfologica', preferred: 'morfológica' },
  { plain: 'morfologicas', preferred: 'morfológicas' },
  { plain: 'morfologico', preferred: 'morfológico' },
  { plain: 'morfologicos', preferred: 'morfológicos' },
  { plain: 'multiplas', preferred: 'múltiplas' },
  { plain: 'multiplos', preferred: 'múltiplos' },
  { plain: 'nao', preferred: 'não' },
  { plain: 'necessaria', preferred: 'necessária' },
  { plain: 'necessarias', preferred: 'necessárias' },
  { plain: 'necessario', preferred: 'necessário' },
  { plain: 'necessarios', preferred: 'necessários' },
  { plain: 'neutrofilica', preferred: 'neutrofílica' },
  { plain: 'neutrofilico', preferred: 'neutrofílico' },
  { plain: 'neutrofilicos', preferred: 'neutrofílicos' },
  { plain: 'neutrofilo', preferred: 'neutrófilo' },
  { plain: 'neutrofilos', preferred: 'neutrófilos' },
  { plain: 'nivel', preferred: 'nível' },
  { plain: 'niveis', preferred: 'níveis' },
  { plain: 'numero', preferred: 'número' },
  { plain: 'observavel', preferred: 'observável' },
  { plain: 'operatorio', preferred: 'operatório' },
  { plain: 'ossea', preferred: 'óssea' },
  { plain: 'padrao', preferred: 'padrão' },
  { plain: 'parametro', preferred: 'parâmetro' },
  { plain: 'parametros', preferred: 'parâmetros' },
  { plain: 'parasitaria', preferred: 'parasitária' },
  { plain: 'parasitarias', preferred: 'parasitárias' },
  { plain: 'participacao', preferred: 'participação' },
  { plain: 'patologica', preferred: 'patológica' },
  { plain: 'patologicas', preferred: 'patológicas' },
  { plain: 'patologico', preferred: 'patológico' },
  { plain: 'patologicos', preferred: 'patológicos' },
  { plain: 'periferico', preferred: 'periférico' },
  { plain: 'periodo', preferred: 'período' },
  { plain: 'possivel', preferred: 'possível' },
  { plain: 'possiveis', preferred: 'possíveis' },
  { plain: 'populacao', preferred: 'população' },
  { plain: 'populacoes', preferred: 'populações' },
  { plain: 'presenca', preferred: 'presença' },
  { plain: 'provavel', preferred: 'provável' },
  { plain: 'producao', preferred: 'produção' },
  { plain: 'proliferacao', preferred: 'proliferação' },
  { plain: 'progressao', preferred: 'progressão' },
  { plain: 'promielocito', preferred: 'promielócito' },
  { plain: 'promielocitos', preferred: 'promielócitos' },
  { plain: 'proporcao', preferred: 'proporção' },
  { plain: 'proteina', preferred: 'proteína' },
  { plain: 'rapida', preferred: 'rápida' },
  { plain: 'rapidas', preferred: 'rápidas' },
  { plain: 'rapido', preferred: 'rápido' },
  { plain: 'rapidos', preferred: 'rápidos' },
  { plain: 'reacao', preferred: 'reação' },
  { plain: 'reacoes', preferred: 'reações' },
  { plain: 'recuperacao', preferred: 'recuperação' },
  { plain: 'reducao', preferred: 'redução' },
  { plain: 'regulacao', preferred: 'regulação' },
  { plain: 'relacao', preferred: 'relação' },
  { plain: 'resistencia', preferred: 'resistência' },
  { plain: 'reticulocito', preferred: 'reticulócito' },
  { plain: 'reticulocitos', preferred: 'reticulócitos' },
  { plain: 'revisao', preferred: 'revisão' },
  { plain: 'secundaria', preferred: 'secundária' },
  { plain: 'secundarias', preferred: 'secundárias' },
  { plain: 'secundario', preferred: 'secundário' },
  { plain: 'secundarios', preferred: 'secundários' },
  { plain: 'sao', preferred: 'são' },
  { plain: 'sanguinea', preferred: 'sanguínea' },
  { plain: 'sanguineas', preferred: 'sanguíneas' },
  { plain: 'sanguineo', preferred: 'sanguíneo' },
  { plain: 'sanguineos', preferred: 'sanguíneos' },
  { plain: 'serie', preferred: 'série' },
  { plain: 'serica', preferred: 'sérica' },
  { plain: 'sericas', preferred: 'séricas' },
  { plain: 'serico', preferred: 'sérico' },
  { plain: 'sericos', preferred: 'séricos' },
  { plain: 'sifilis', preferred: 'sífilis' },
  { plain: 'situacao', preferred: 'situação' },
  { plain: 'situacoes', preferred: 'situações' },
  { plain: 'simultaneo', preferred: 'simultâneo' },
  { plain: 'simultaneos', preferred: 'simultâneos' },
  { plain: 'simultanea', preferred: 'simultânea' },
  { plain: 'simultaneas', preferred: 'simultâneas' },
  { plain: 'sindrome', preferred: 'síndrome' },
  { plain: 'sintese', preferred: 'síntese' },
  { plain: 'sistemica', preferred: 'sistêmica' },
  { plain: 'subpopulacao', preferred: 'subpopulação' },
  { plain: 'subpopulacoes', preferred: 'subpopulações' },
  { plain: 'supressao', preferred: 'supressão' },
  { plain: 'tambem', preferred: 'também' },
  { plain: 'tipica', preferred: 'típica' },
  { plain: 'tipicas', preferred: 'típicas' },
  { plain: 'tipico', preferred: 'típico' },
  { plain: 'tipicos', preferred: 'típicos' },
  { plain: 'toxicologica', preferred: 'toxicológica' },
  { plain: 'toxica', preferred: 'tóxica' },
  { plain: 'toxicas', preferred: 'tóxicas' },
  { plain: 'transitorio', preferred: 'transitório' },
  { plain: 'continuo', preferred: 'contínuo' },
  { plain: 'utilizacao', preferred: 'utilização' },
  { plain: 'varios', preferred: 'vários' },
  { plain: 'virus', preferred: 'vírus' }
];

export const ITALIAN_DIACRITIC_RISK_WORDS = [
  { plain: 'cosi', preferred: 'così' },
  { plain: 'gia', preferred: 'già' },
  { plain: 'nonche', preferred: 'nonché' },
  { plain: 'perche', preferred: 'perché' },
  { plain: 'piu', preferred: 'più' },
  { plain: 'poiche', preferred: 'poiché' },
  { plain: 'puo', preferred: 'può' }
];

const getDiacriticRiskMap = (targetLang?: TargetLanguage) => {
  const profile = getTargetLanguageProfile(targetLang);
  if (!profile?.diacriticRiskWords?.length) return null;
  return new Map(profile.diacriticRiskWords.map((item) => [normalizeLatinToken(item.plain), item]));
};

export const isRussianTarget = (targetLang?: TargetLanguage) =>
  String(targetLang || '').toLowerCase().includes('russian');

export const isFrenchTarget = (targetLang?: TargetLanguage) =>
  String(targetLang || '').toLowerCase().includes('french');

export const isPortugueseTarget = (targetLang?: TargetLanguage) =>
  String(targetLang || '').toLowerCase().includes('portuguese');

export const isRussianDisallowedLatinResidue = (token: string) =>
  RUSSIAN_DISALLOWED_LATIN_RESIDUE_SET.has(normalizeLatinToken(token));

export const getRussianResidueProfile = () => ({
  target: 'Russian' as const,
  disallowedLatinResidueWords: [...RUSSIAN_DISALLOWED_LATIN_RESIDUE_WORDS]
});

export const TARGET_LANGUAGE_PROFILES: Record<string, TargetLanguageProfile> = {
  russian: {
    target: 'Russian',
    script: 'cyrillic',
    disallowedLatinResidueWords: [...RUSSIAN_DISALLOWED_LATIN_RESIDUE_WORDS],
    notes: [
      'Flag ordinary English UI/manual words mixed into Cyrillic text.',
      'Allow protected brands, medical abbreviations, units, model names, and IDs.'
    ]
  },
  french: {
    target: 'French',
    script: 'latin',
    englishResidueWords: [...FRENCH_ENGLISH_RESIDUE_WORDS],
    englishResiduePhrases: [...FRENCH_ENGLISH_RESIDUE_PHRASES],
    diacriticRiskWords: [...FRENCH_DIACRITIC_RISK_WORDS],
    commonFunctionWords: ['le', 'la', 'les', 'des', 'une', 'avec', 'pour', 'dans', 'sur'],
    distinctiveCharacters: /[éèêëàâçîïôûùüÿœ]/i,
    notes: [
      'Use standard French orthography with accents for medical/common terms.',
      'Conserve numeric/unit forms such as 2-8°C when source uses compact medical formatting.',
      'Do not over-flag shared Latin medical abbreviations as English.'
    ]
  },
  spanish: {
    target: 'Spanish',
    script: 'latin',
    commonFunctionWords: ['el', 'la', 'los', 'las', 'del', 'para', 'con', 'sin', 'por'],
    distinctiveCharacters: /[ñáéíóúü¡¿]/i,
    notes: [
      'Prefer Spanish function words and punctuation while preserving medical codes and units.',
      'Do not treat shared Latin medical terms as English residue without a strong signal.'
    ]
  },
  portuguese: {
    target: 'Portuguese',
    script: 'latin',
    preferredLocale: 'pt-BR',
    diacriticRiskWords: [...PORTUGUESE_DIACRITIC_RISK_WORDS],
    commonFunctionWords: ['o', 'a', 'os', 'as', 'de', 'em', 'com', 'para'],
    distinctiveCharacters: /[ãõçáéíóúàâêô]/i,
    notes: [
      'Target locale is Brazilian Portuguese (pt-BR), not European Portuguese.',
      'Preserve compact number/unit formatting.',
      'Use standard Portuguese orthography with diacritics for medical/common terms.'
    ]
  },
  german: {
    target: 'German',
    script: 'latin',
    commonFunctionWords: ['der', 'die', 'das', 'und', 'mit', 'bei', 'für'],
    distinctiveCharacters: /[äöüß]/i,
    notes: [
      'Expect German noun capitalization and compound words.',
      'Preserve model numbers, IDs, and units exactly.'
    ]
  },
  italian: {
    target: 'Italian',
    script: 'latin',
    diacriticRiskWords: [...ITALIAN_DIACRITIC_RISK_WORDS],
    commonFunctionWords: ['il', 'la', 'le', 'di', 'con', 'per', 'una', 'un', 'che', 'non'],
    distinctiveCharacters: /[àèéìòù]/i,
    notes: [
      'Use Italian function-word signal conservatively because many medical terms are shared Latin.',
      'Flag missing accents only on high-confidence Italian function words such as può, più and perché.',
      'Preserve numeric and unit formatting.'
    ]
  },
  turkish: {
    target: 'Turkish',
    script: 'latin',
    commonFunctionWords: ['ve', 'ile', 'bu', 'bir', 'için'],
    distinctiveCharacters: /[çğıöşü]/i,
    notes: [
      'Treat Turkish-specific characters as positive signal.',
      'Preserve medical abbreviations and model identifiers.'
    ]
  },
  'traditional chinese (taiwan)': {
    target: 'Traditional Chinese (Taiwan)',
    script: 'cjk',
    preferredLocale: 'zh-TW',
    notes: [
      'Flag Simplified Chinese residue and mainland phrasing in Taiwan-targeted output.',
      'Preserve medical abbreviations, IDs, and units.'
    ]
  }
};

export const getTargetLanguageProfile = (targetLang?: TargetLanguage) => {
  const normalized = String(targetLang || '').toLowerCase();
  return Object.entries(TARGET_LANGUAGE_PROFILES).find(([key]) => normalized.includes(key))?.[1] || null;
};

export const isProfileEnglishResidueToken = (token: string, targetLang?: TargetLanguage) => {
  const profile = getTargetLanguageProfile(targetLang);
  if (!profile?.englishResidueWords?.length) return false;
  return new Set(profile.englishResidueWords.map(normalizeLatinToken)).has(normalizeLatinToken(token));
};

export const hasProfileEnglishResidue = (text: string, targetLang?: TargetLanguage) => {
  const profile = getTargetLanguageProfile(targetLang);
  if (!profile) return false;
  const normalizedText = normalizeLatinToken(text).replace(/[^a-z0-9]+/g, ' ');
  if (
    profile.englishResiduePhrases?.some((phrase) =>
      normalizedText.includes(normalizeLatinToken(phrase).replace(/[^a-z0-9]+/g, ' '))
    )
  ) {
    return true;
  }
  const tokens = text.match(/\b[A-Za-z][A-Za-z0-9'-]{1,}\b/g) || [];
  return tokens.some((token) => isProfileEnglishResidueToken(token, targetLang));
};

export const collectTargetDiacriticRisks = (text: string, targetLang?: TargetLanguage) => {
  const riskMap = getDiacriticRiskMap(targetLang);
  if (!riskMap) return [];
  const tokens = String(text || '').match(/\b[A-Za-zÀ-ÖØ-öø-ÿœŒ][A-Za-zÀ-ÖØ-öø-ÿœŒ'-]{2,}\b/g) || [];
  const risks: Array<{ token: string; preferred: string }> = [];
  tokens.forEach((token) => {
    const candidates = Array.from(new Set([token, ...token.split(/['’]/g)])).filter(
      (item) => item.length >= 3
    );
    candidates.forEach((candidate) => {
      if (/[À-ÖØ-öø-ÿœŒ]/.test(candidate)) return;
      const risk = riskMap.get(normalizeLatinToken(candidate));
      if (!risk) return;
      risks.push({ token: candidate, preferred: risk.preferred });
    });
  });
  return risks;
};

export const collectFrenchDiacriticRisks = (text: string, targetLang?: TargetLanguage) => {
  if (!isFrenchTarget(targetLang)) return [];
  return collectTargetDiacriticRisks(text, targetLang);
};

export const collectPortugueseDiacriticRisks = (text: string, targetLang?: TargetLanguage) => {
  if (!isPortugueseTarget(targetLang)) return [];
  return collectTargetDiacriticRisks(text, targetLang);
};

export const hasFrenchDiacriticRisk = (text: string, targetLang?: TargetLanguage) =>
  collectFrenchDiacriticRisks(text, targetLang).length > 0;

export const hasPortugueseDiacriticRisk = (text: string, targetLang?: TargetLanguage) =>
  collectPortugueseDiacriticRisks(text, targetLang).length > 0;

export const hasTargetDiacriticRisk = (text: string, targetLang?: TargetLanguage) =>
  collectTargetDiacriticRisks(text, targetLang).length > 0;
