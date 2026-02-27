class LessonLabParser:
    def parse_text(self, text):
        res = {"title": "Nomsiz Test", "questions": []}; q = None
        for line in [l.strip() for l in text.split('\n') if l.strip()]:
            if line.startswith('#'): res['title'] = line[1:].strip()
            elif line.startswith('?'):
                if q: q['hint'] = line[1:].strip()
            elif line[0] in '+-':
                if q: q['options'].append({"text": line[1:].strip(), "is_correct": line[0] == '+'})
            else:
                # Save previous question if it has at least one correct option
                if q and any(opt['is_correct'] for opt in q['options']):
                    res['questions'].append(q)
                q = {"text": line, "options": []}
        
        # Final check for the last question
        if q and any(opt['is_correct'] for opt in q['options']):
            res['questions'].append(q)
        return res