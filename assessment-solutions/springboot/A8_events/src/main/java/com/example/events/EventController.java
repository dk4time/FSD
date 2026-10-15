package com.example.events;

import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Event Tickets API (Assessment Set A8).
 *
 * The body is taken as a plain Object (a Map after Jackson parses it) instead of a typed class,
 * because Jackson would silently turn "12" into 12, 1.5 into 1 and "true" into true.
 * Every type is checked by hand here.
 */
@RestController
@RequestMapping("/api/events")
public class EventController {

    private static final List<String> CATEGORIES = List.of("Music", "Tech", "Sports", "Workshop", "Festival");
    private static final List<String> SORT_FIELDS = List.of("title", "ticketPrice", "seatsAvailable");
    private static final List<String> FIELDS = List.of("title", "venue", "category", "ticketPrice", "seatsAvailable", "isOnline");

    private final List<Map<String, Object>> events = new ArrayList<>(); // creation order
    private long nextId = 1;

    // ---------------- endpoints ----------------

    @PostMapping
    public synchronized ResponseEntity<Map<String, Object>> create(@RequestBody(required = false) Object body) {
        Map<String, Object> clean = validate(body, false);
        Map<String, Object> record = buildRecord(nextId++, clean);
        events.add(record);
        return ResponseEntity.status(HttpStatus.CREATED).body(record);
    }

    @GetMapping
    public synchronized Map<String, Object> list(@RequestParam MultiValueMap<String, String> params) {
        long page = 1;
        String pageText = param(params, "page");
        if (pageText != null) {
            page = parsePositiveLong(pageText, "page");
        }
        int limit = 10;
        String limitText = param(params, "limit");
        if (limitText != null) {
            long limitValue = parsePositiveLong(limitText, "limit");
            if (limitValue > 50) throw badRequest("limit must be at most 50");
            limit = (int) limitValue;
        }

        String category = param(params, "category");
        if (category != null && !CATEGORIES.contains(category)) throw badRequest("category is not valid");

        String isOnlineText = param(params, "isOnline");
        if (isOnlineText != null && !isOnlineText.equals("true") && !isOnlineText.equals("false")) {
            throw badRequest("isOnline must be true or false");
        }
        Double minTicketPrice = parseNumber(param(params, "minTicketPrice"), "minTicketPrice");
        Double maxTicketPrice = parseNumber(param(params, "maxTicketPrice"), "maxTicketPrice");

        String sort = param(params, "sort");
        if (sort != null && !SORT_FIELDS.contains(sort)) throw badRequest("sort must be one of " + SORT_FIELDS);
        String order = param(params, "order");
        if (order != null && !order.equals("asc") && !order.equals("desc")) throw badRequest("order must be asc or desc");
        String search = param(params, "search");

        // 1. filters
        List<Map<String, Object>> result = new ArrayList<>();
        for (Map<String, Object> p : events) {
            double ticketPrice = ((Number) p.get("ticketPrice")).doubleValue();
            if (category != null && !category.equals(p.get("category"))) continue;
            if (isOnlineText != null && !p.get("isOnline").equals(Boolean.parseBoolean(isOnlineText))) continue;
            if (minTicketPrice != null && ticketPrice < minTicketPrice) continue;
            if (maxTicketPrice != null && ticketPrice > maxTicketPrice) continue;
            result.add(p);
        }

        // 2. search (empty value = no search)
        if (search != null && !search.trim().isEmpty()) {
            String term = search.toLowerCase(Locale.ROOT);
            result.removeIf(p -> !((String) p.get("title")).toLowerCase(Locale.ROOT).contains(term)
                    && !((String) p.get("venue")).toLowerCase(Locale.ROOT).contains(term));
        }

        // 3. sort (List.sort is stable, so ties keep creation order)
        if (sort != null) {
            Comparator<Map<String, Object>> cmp;
            if (sort.equals("title")) {
                cmp = Comparator.comparing(p -> ((String) p.get("title")).toLowerCase(Locale.ROOT));
            } else {
                cmp = Comparator.comparingDouble(p -> ((Number) p.get(sort)).doubleValue());
            }
            if ("desc".equals(order)) cmp = cmp.reversed();
            result.sort(cmp);
        }

        // 4. pagination
        int total = result.size();
        int from = page - 1 >= total ? total : (int) Math.min((page - 1) * limit, total);
        int to = Math.min(from + limit, total);

        Map<String, Object> response = new LinkedHashMap<>();
        response.put("data", new ArrayList<>(result.subList(from, to)));
        response.put("page", page);
        response.put("limit", limit);
        response.put("total", total);
        response.put("totalPages", total == 0 ? 0 : (total + limit - 1) / limit);
        return response;
    }

    @GetMapping("/{id}")
    public synchronized Map<String, Object> getOne(@PathVariable String id) {
        return events.get(findIndex(id));
    }

    @PutMapping("/{id}")
    public synchronized Map<String, Object> replace(@PathVariable String id, @RequestBody(required = false) Object body) {
        int index = findIndex(id);
        Map<String, Object> clean = validate(body, false);
        Map<String, Object> record = buildRecord(events.get(index).get("id"), clean);
        events.set(index, record);
        return record;
    }

    @PatchMapping("/{id}")
    public synchronized Map<String, Object> update(@PathVariable String id, @RequestBody(required = false) Object body) {
        int index = findIndex(id);
        Map<String, Object> clean = validate(body, true);
        Map<String, Object> merged = new LinkedHashMap<>(events.get(index));
        merged.putAll(clean);
        Map<String, Object> record = buildRecord(merged.get("id"), merged);
        events.set(index, record);
        return record;
    }

    @DeleteMapping("/{id}")
    public synchronized ResponseEntity<Void> delete(@PathVariable String id) {
        events.remove(findIndex(id));
        return ResponseEntity.noContent().build();
    }

    // ---------------- helpers ----------------

    private int findIndex(String id) {
        for (int i = 0; i < events.size(); i++) {
            if (String.valueOf(events.get(i).get("id")).equals(id)) return i;
        }
        throw new ApiException(HttpStatus.NOT_FOUND, "Record not found");
    }

    private Map<String, Object> buildRecord(Object id, Map<String, Object> data) {
        Map<String, Object> r = new LinkedHashMap<>();
        r.put("id", id);
        for (String f : FIELDS) r.put(f, data.get(f));
        return r;
    }

    /** Validates a POST/PUT body (partial = false) or a PATCH body (partial = true). Returns the cleaned fields. */
    private Map<String, Object> validate(Object rawBody, boolean partial) {
        if (!(rawBody instanceof Map)) throw badRequest("Request body must be a JSON object");
        Map<?, ?> body = (Map<?, ?>) rawBody;
        Map<String, Object> clean = new LinkedHashMap<>();
        for (String field : FIELDS) {
            if (!body.containsKey(field)) {
                if (partial) continue;
                throw badRequest(field + " is required");
            }
            Object v = body.get(field);
            switch (field) {
                case "title" -> clean.put(field, checkText(v, field, 3, 60));
                case "venue" -> clean.put(field, checkText(v, field, 2, 40));
                case "category" -> {
                    if (!(v instanceof String s) || !CATEGORIES.contains(s)) {
                        throw badRequest("category must be one of " + CATEGORIES);
                    }
                    clean.put(field, v);
                }
                case "ticketPrice" -> {
                    if (!isNumber(v)) throw badRequest("ticketPrice must be a number");
                    double d = ((Number) v).doubleValue();
                    if (d <= 0) throw badRequest("ticketPrice must be greater than 0");
                    if (d > 50000) throw badRequest("ticketPrice must be at most 50000");
                    clean.put(field, v);
                }
                case "seatsAvailable" -> {
                    if (!isWholeNumber(v)) throw badRequest("seatsAvailable must be a whole number");
                    long n = ((Number) v).longValue();
                    if (n < 0 || n > 100000) throw badRequest("seatsAvailable must be from 0 to 100000");
                    clean.put(field, n);
                }
                case "isOnline" -> {
                    if (!(v instanceof Boolean)) throw badRequest("isOnline must be true or false");
                    clean.put(field, v);
                }
                default -> { }
            }
        }
        if (partial && clean.isEmpty()) throw badRequest("Send at least one field to update");
        return clean;
    }

    private String checkText(Object v, String field, int min, int max) {
        if (!(v instanceof String s)) throw badRequest(field + " must be a string");
        String t = s.trim();
        if (t.isEmpty()) throw badRequest(field + " must not be blank");
        if (t.length() < min || t.length() > max) throw badRequest(field + " must be " + min + " to " + max + " characters");
        return t;
    }

    private boolean isNumber(Object v) {
        return v instanceof Number n && Double.isFinite(n.doubleValue());
    }

    private boolean isWholeNumber(Object v) {
        if (v instanceof Integer || v instanceof Long || v instanceof Short || v instanceof BigInteger) return true;
        if (v instanceof Double || v instanceof Float || v instanceof BigDecimal) {
            double d = ((Number) v).doubleValue();
            return Double.isFinite(d) && d == Math.rint(d); // 40.0 is the same JSON number as 40
        }
        return false;
    }

    /** Returns the single value of a query parameter, null if absent; repeating a parameter is invalid. */
    private String param(MultiValueMap<String, String> params, String name) {
        List<String> values = params.get(name);
        if (values == null || values.isEmpty()) return null;
        if (values.size() > 1) throw badRequest(name + " must be given only once");
        return values.get(0);
    }

    private long parsePositiveLong(String text, String name) {
        if (!text.matches("\\d+")) throw badRequest(name + " must be a positive integer");
        BigInteger n = new BigInteger(text);
        if (n.signum() == 0) throw badRequest(name + " must be a positive integer");
        // a huge page number is still valid (it is just past the last page), so don't overflow an int
        return n.bitLength() < 63 ? n.longValue() : Long.MAX_VALUE;
    }

    private Double parseNumber(String text, String name) {
        if (text == null) return null;
        // plain decimal numbers only, e.g. 400, -2, 12.75, 1e3 (Java would also accept "NaN" or "1d")
        if (!text.matches("[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?")) throw badRequest(name + " must be a number");
        double d = Double.parseDouble(text);
        if (!Double.isFinite(d)) throw badRequest(name + " must be a number");
        return d;
    }

    private ApiException badRequest(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, message);
    }
}
