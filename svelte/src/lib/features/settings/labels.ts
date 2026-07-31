import type { FieldEntity, FieldScope, FieldType } from '$lib/domain/field-definitions';
import * as m from '$lib/i18n/messages';

export function fieldTypeLabel(type: FieldType): string {
	switch (type) {
		case 'text':
			return m.settings_fieldType_text();
		case 'longtext':
			return m.settings_fieldType_longtext();
		case 'number':
			return m.settings_fieldType_number();
		case 'money':
			return m.settings_fieldType_money();
		case 'date':
			return m.settings_fieldType_date();
		case 'select':
			return m.settings_fieldType_select();
		case 'boolean':
			return m.settings_fieldType_boolean();
	}
}

export function fieldEntityLabel(entity: FieldEntity): string {
	switch (entity) {
		case 'contact':
			return m.settings_entity_contact();
		case 'project':
			return m.settings_entity_project();
		case 'campaign':
			return m.settings_entity_campaign();
	}
}

export function fieldScopeLabel(scope: FieldScope): string {
	return scope === 'campaign' ? m.settings_scope_campaign() : m.settings_scope_org();
}
